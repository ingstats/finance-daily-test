/**
 * 지표 수집기 — 사이트 저장소의 indicators.json에 적힌 지표를 원천에서 받아 data/market.json을 만들고 GitHub에 커밋한다.
 * 교육생은 Claude에게 "○○ 지표 추가해 줘"라고만 하면 Claude가 indicators.json을 고친다. 이 코드는 고치지 않는다.
 *
 * indicators.json = {indicators:[{id,label,group,unit,decimals,change,source,note?,fetch,lo?,hi?,jump?,jump_pct?}], sources:{원천이름: 주소}}
 *   fetch.type = 'ecos'  : {table, item, cycle:'D'|'M'}  한국은행 ECOS 통계표·항목 코드 (ECOS_KEY 없으면 시험용 키로 10건씩 나눠 받음)
 *   fetch.type = 'yahoo' : {symbol}                    Yahoo Finance 일별 종가 (예: ^KS11, KRW=X, CL=F, ^IXIC)
 * 검사: 범위(lo~hi), 하루 변동 한도(jump: 값 차이, jump_pct: %). 어긋나면 그 지표만 이전 값을 유지하고 담당자에게 알림.
 * 평일 MARKET_AT(기본 06:20) 이후 tick에서 하루 한 번 실행. 새 지표는 처음 실행 때 1년치를 채운다.
 */
const MARKET_KEEP_DAYS = 400;

function marketTick_() {
  const now = new Date(), today = ymd_(now), hhmm = hm_(now);
  if (dow_(now) > 5 || hhmm < (SET.MARKET_AT || '06:20') || hhmm > '11:00') return;
  if (P.getProperty('MARKET_DONE') === today) return;
  // 실패하면 20분 뒤 다시(하루 최대 3번). 3번째도 실패하면 담당자에게 알림
  const tries = JSON.parse(P.getProperty('MARKET_TRIES') || '{}');
  if (tries.d !== today) { tries.d = today; tries.n = 0; tries.at = 0; }
  if (tries.n >= 3 || Date.now() - (tries.at || 0) < 20 * 60e3) return;
  tries.n++; tries.at = Date.now(); P.setProperty('MARKET_TRIES', JSON.stringify(tries));
  const r = collectMarket_();
  log_('지표 수집 ' + (r.ok ? '완료' : '일부 실패(' + tries.n + '/3)') + ': ' + r.summary.join(', ').slice(0, 150));
  if (r.ok || tries.n >= 3) P.setProperty('MARKET_DONE', today);
  if (r.errors.length && tries.n >= 3) notifyOwnerSafe_('[' + NAME + ' 지표] ' + r.errors.join(' / ').slice(0, 160));
  // GitHub 토큰 만료 30일 전부터 월요일마다 알림
  const exp = Date.parse(String(P.getProperty('GITHUB_TOKEN_EXPIRES') || '').replace(' UTC', 'Z').replace(' ', 'T'));
  if (exp && exp - Date.now() < 30 * 864e5 && dow_(now) === 1) notifyOwnerSafe_('[' + NAME + '] 사이트 반영용 GitHub 토큰이 ' + Utilities.formatDate(new Date(exp), TZ, 'yyyy-MM-dd') + '에 만료됩니다. Claude에게 "GitHub 토큰 다시 만들어 줘"라고 말해 주세요.');
}

/** 편집기에서 직접 실행: 지금 수집해 market.json을 커밋 */
function collectMarketNow() { const r = collectMarket_(); console.log(JSON.stringify(r, null, 1)); }

/** 시험: 커밋하지 않고 원천에서 받은 최근 값만 로그로 */
function testMarket() { const r = collectMarket_(true); console.log(JSON.stringify(r, null, 1)); }

function collectMarket_(dry) {
  const cfgFile = ghGet_('indicators.json');
  if (!cfgFile) throw new Error('저장소에 indicators.json이 없습니다.');
  const cfg = JSON.parse(cfgFile.text);
  const defs = cfg.indicators || [];
  const curFile = ghGet_('data/market.json');
  const cur = curFile ? JSON.parse(curFile.text) : { indicators: [] };
  const old = {};
  (cur.indicators || []).forEach(function (i) { old[i.id] = i.series || []; });
  const today = ymd_();
  const errors = [], summary = [], out = [];
  defs.forEach(function (d) {
    const prev = old[d.id] || [];
    const from = prev.length ? shiftDays_(prev[prev.length - 1][0], -20) : shiftDays_(today, -370);
    let fresh = [];
    try { fresh = fetchSeries_(d, from, today); }
    catch (e) { errors.push(d.label + ': ' + errText_(e).slice(0, 100)); }
    const merged = mergeSeries_(prev, fresh, today);
    const bad = checkSeries_(d, merged);
    const series = bad ? prev : merged;
    if (bad) errors.push(d.label + ': ' + bad);
    out.push({ id: d.id, label: d.label, group: d.group, unit: d.unit || '', decimals: d.decimals == null ? 2 : d.decimals,
      change: d.change || 'pct', source: d.source || '', note: d.note || undefined, series: series });
    summary.push(d.id + '=' + (series.length ? series[series.length - 1].join(' ') : '없음'));
  });
  const mk = { schema: 'ax-market/1', updated_at: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"), indicators: out, sources: cfg.sources || {} };
  let commit = 'dry-run';
  if (!dry) commit = ghPut_('data/market.json', JSON.stringify(mk), '지표 갱신 ' + today);
  return { ok: !errors.length, commit: commit, summary: summary, errors: errors };
}

function shiftDays_(iso, n) { const d = new Date(iso + 'T00:00:00+09:00'); d.setDate(d.getDate() + n); return ymd_(d); }

/** 기존 값과 새 값을 날짜로 합침(같은 날짜는 새 값), 오래된 것은 버림 */
function mergeSeries_(prev, fresh, today) {
  const by = {};
  prev.forEach(function (p) { by[p[0]] = p[1]; });
  fresh.forEach(function (p) { by[p[0]] = p[1]; });
  const cut = shiftDays_(today, -MARKET_KEEP_DAYS);
  return Object.keys(by).filter(function (d) { return d >= cut && d <= today; }).sort().map(function (d) { return [d, by[d]]; });
}

/** 범위·변동 한도 검사. 문제가 있으면 문구, 없으면 '' */
function checkSeries_(d, s) {
  for (let i = 0; i < s.length; i++) {
    const v = s[i][1];
    if (typeof v !== 'number' || !isFinite(v)) return '숫자가 아닌 값 ' + s[i][0];
    if (d.lo != null && v < d.lo || d.hi != null && v > d.hi) return '범위를 벗어난 값 ' + s[i][0] + ' ' + v;
    if (i) {
      const p = s[i - 1][1];
      if (d.jump != null && Math.abs(v - p) > d.jump) return '하루 변동 한도 초과 ' + s[i][0] + ' ' + p + '→' + v;
      if (d.jump_pct != null && p && Math.abs(v / p - 1) * 100 > d.jump_pct) return '하루 변동 한도 초과 ' + s[i][0] + ' ' + p + '→' + v;
    }
  }
  return '';
}

function fetchSeries_(d, from, to) {
  const f = d.fetch || {};
  if (f.type === 'ecos') return ecosSeries2_(f, from, to);
  if (f.type === 'yahoo') return yahooSeries_(f.symbol, from, to);
  throw new Error('알 수 없는 원천 종류: ' + f.type);
}

/** 한국은행 ECOS StatisticSearch. 시험용 키는 한 번에 10건이라 기간을 나눠 받는다 */
function ecosSeries2_(f, from, to) {
  const key = String(P.getProperty('ECOS_KEY') || 'sample').trim();
  const cyc = f.cycle || 'D';
  const fmt = function (iso) { return cyc === 'M' ? iso.slice(0, 4) + iso.slice(5, 7) : iso.replace(/-/g, ''); };
  const windows = [];
  if (key !== 'sample') windows.push([from, to]);
  else {
    const step = cyc === 'M' ? 300 : 13;                 // 13일 = 평일 10일 이하, 월간은 10개월
    for (let s = from; s <= to; s = shiftDays_(s, step + 1)) { const e = shiftDays_(s, step); windows.push([s, e < to ? e : to]); }
  }
  const out = [];
  const n = key === 'sample' ? 10 : 1000;
  windows.forEach(function (w) {
    const url = ['https://ecos.bok.or.kr/api/StatisticSearch', encodeURIComponent(key), 'json/kr/1', n, f.table, cyc, fmt(w[0]), fmt(w[1]), f.item].join('/');
    // ECOS가 가끔 연결을 끊는다(Address unavailable) → 최대 3번, 쉬었다가 다시 시도
    let r = null, lastErr = null;
    for (let a = 0; a < 3 && !r; a++) {
      try { r = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
      catch (e) { lastErr = e; Utilities.sleep(1500 * (a + 1)); }
    }
    if (!r) throw new Error('ECOS 연결 실패(' + w[0] + '~' + w[1] + '): ' + (lastErr && lastErr.message));
    if (r.getResponseCode() !== 200) throw new Error('ECOS HTTP ' + r.getResponseCode());
    const j = JSON.parse(r.getContentText());
    if (!j.StatisticSearch) {
      const res = j.RESULT || {};
      if (res.CODE === 'INFO-200') return;                // 해당 기간 자료 없음(휴일 등)
      throw new Error('ECOS ' + (res.CODE || '') + ' ' + (res.MESSAGE || ''));
    }
    if (j.StatisticSearch.list_total_count > j.StatisticSearch.row.length) throw new Error('ECOS 건수 초과(인증키 필요)');
    j.StatisticSearch.row.forEach(function (x) {
      const t = String(x.TIME);
      const iso = t.length === 6 ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-01' : t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8);
      const v = Number(String(x.DATA_VALUE).replace(/,/g, ''));
      if (isFinite(v)) out.push([iso, v]);
    });
    if (key === 'sample') Utilities.sleep(200);
  });
  return out;
}

/** Yahoo Finance 일별 종가 (거래소 현지 날짜) */
function yahooSeries_(symbol, from, to) {
  const p1 = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000), p2 = Math.floor(Date.now() / 1000);
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&period1=' + p1 + '&period2=' + p2;
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (r.getResponseCode() !== 200) throw new Error('Yahoo HTTP ' + r.getResponseCode());
  const res = (JSON.parse(r.getContentText()).chart || {}).result;
  if (!res || !res[0] || !res[0].timestamp) throw new Error('Yahoo 자료 없음');
  const tz = (res[0].meta && res[0].meta.exchangeTimezoneName) || 'UTC';
  const close = res[0].indicators.quote[0].close;
  const now = Date.now() / 1000;
  const out = [];
  res[0].timestamp.forEach(function (ts, i) {
    const d = Utilities.formatDate(new Date(ts * 1000), tz, 'yyyy-MM-dd');
    if (close[i] == null || ts + 7 * 3600 > now) return;  // 장중 값 제외: 개장 후 7시간이 지난(마감된) 날만
    out.push([d, Math.round(close[i] * 10000) / 10000]);
  });
  return out;
}
