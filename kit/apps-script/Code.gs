/**
 * 팀 데일리 — 카카오톡 발송기 (Google Apps Script). AX Daily Report 발송기를 교육용으로 일반화한 것.
 *
 * 구독자 각자에게 카카오 '나에게 보내기'로 보낸다(메시지는 구독자 본인의 '나와의 채팅', 알림 없음).
 * 구독자는 팀 사이트의 '카카오톡으로 받기'에서 이름 입력 → 카카오 로그인 → '카카오톡 메시지 전송' 동의만 한다.
 *
 * 설정은 모두 [프로젝트 설정 → 스크립트 속성]에 둔다 (코드는 고치지 않음)
 *   NEWSLETTER_ID      영문 소문자 id (예: finance-daily). Gmail 초안 머리표 [ID-KAKAO]·[ID-SITE]에 쓰임
 *   NEWSLETTER_NAME    뉴스레터 이름 (예: 재무팀 데일리)
 *   SITE_URL           팀 사이트 주소 (예: https://ingstats.github.io/finance-daily-test)
 *   WEB_APP_URL        이 프로젝트를 웹 앱으로 배포한 주소(…/exec). 카카오 Redirect URI와 같아야 함
 *   KAKAO_REST_API_KEY 카카오 디벨로퍼스 > 앱 키 > REST API 키  ← 교육생이 직접 붙여넣음
 *   KAKAO_CLIENT_SECRET 클라이언트 시크릿을 켰을 때만          ← 교육생이 직접 붙여넣음
 *   GITHUB_REPO        사이트 저장소 (예: ingstats/finance-daily-test)   ← Site.gs
 *   GITHUB_TOKEN       사이트 저장소 1개에만 쓰기 권한이 있는 토큰       ← 교육생이 직접 붙여넣음
 *   ECOS_KEY           (선택) 한국은행 ECOS 인증키. 없으면 시험용 키      ← Market.gs
 *
 * 하루 흐름 (모두 tick 1분 트리거가 처리)
 *  06:20~  Market.gs  지표 수집 → 사이트 data/market.json 커밋
 *  07:10~  Claude 예약 작업이 오늘 호를 만들고 Gmail 임시보관함에 [ID-SITE]·[ID-KAKAO] 초안을 넣는다
 *  즉시    Site.gs    [ID-SITE] 초안의 파일을 GitHub에 커밋 → GitHub Pages 갱신
 *  08:00   이 파일    [ID-KAKAO] 초안의 메시지를 구독자 전원에게 보냄
 */
const P = PropertiesService.getScriptProperties();
const SET = P.getProperties();
const SITE = String(SET.SITE_URL || '').replace(/\/+$/, '');
const NAME = SET.NEWSLETTER_NAME || '팀 데일리';
const NID = String(SET.NEWSLETTER_ID || 'daily').toUpperCase();
const CONFIG = {
  REDIRECT_URI: SET.WEB_APP_URL || '', // 카카오에 등록한 Redirect URI와 똑같아야 함
  SEND_AT: SET.SEND_AT || '08:00',     // 이 시각 이후에 오늘 호 초안을 처리
  WINDOW: ['07:55', '10:00'],          // 오늘 호 초안은 이 시간대에만 확인
  ALLOWED_HOSTS: [SITE.replace(/^https?:\/\//, '').split('/')[0]], // 메시지 링크 도메인 (카카오 앱 사이트 도메인과 같아야 함)
  SUBJECT_PREFIX: '[' + NID + '-KAKAO]',
  SEND_TO_ME: true,                   // 담당자(발신 연결 계정)도 '나와의 채팅'으로 사본을 받음
  LEGACY_FRIENDS: false,              // 교육용: '친구에게 보내기' 쓰지 않음
  MAX_TEXT: 200,                      // 카카오 텍스트 템플릿 본문 한도
  NEWSLETTER_URL: SITE,
  DATA_URL: SITE + '/data',           // 지난 호 메시지를 만들 때 읽는 사이트 자료
  APPLY_PER_HOUR: 10,
  MAX_TRIES: 3,
  BATCH: 20,
  TIME_BUDGET_MS: 240000,
};

const TZ = 'Asia/Seoul';
const KAUTH = 'https://kauth.kakao.com';
const KAPI = 'https://kapi.kakao.com';

function ymd_(d) { return Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM-dd'); }
function hm_(d) { return Utilities.formatDate(d || new Date(), TZ, 'HH:mm'); }
function dow_(d) { return Number(Utilities.formatDate(d || new Date(), TZ, 'u')); } // 1=월 … 7=일

/* ───────────── 매분 실행 ───────────── */

function tick() {
  try { if (typeof siteTick_ === 'function') siteTick_(); } catch (e) { log_('사이트 반영 오류: ' + errText_(e)); }
  try { if (typeof marketTick_ === 'function') marketTick_(); } catch (e) { log_('지표 수집 오류: ' + errText_(e)); }
  const start = Date.now();
  const now = new Date();
  const today = ymd_(now), hhmm = hm_(now);
  const draftDue = P.getProperty('LAST_DONE_DATE') !== today && (
    (dow_(now) <= 5 && hhmm >= CONFIG.SEND_AT && hhmm >= CONFIG.WINDOW[0] && hhmm <= CONFIG.WINDOW[1]) ||
    (hhmm >= '06:00' && hhmm <= '22:00' && !!findDraft_(today, '즉시')));   // 설치 첫날: 제목 '즉시' 초안은 시간대와 관계없이 바로 보냄
  if (!draftDue && !anyDue_(today)) return;          // 할 일이 없으면 아무것도 쓰지 않고 끝
  if (!beginRun_()) return;                          // 앞 실행이 아직 돌고 있으면 건너뜀
  try {
    if (draftDue) {
      try { processDraft_(today, start + CONFIG.TIME_BUDGET_MS); }
      catch (e) {
        log_('오늘 호 처리 오류: ' + errText_(e));
        const d = findDraft_(today, '대기') || findDraft_(today, '즉시');
        if (d) finish_(d, d.getMessage(), d.getMessage().getPlainBody(), today, '실패', { error: errText_(e) });
      }
    }
    deliverPending_(today, start + CONFIG.TIME_BUDGET_MS);
  } catch (e) {
    log_('tick 오류: ' + errText_(e));
  } finally {
    endRun_();
  }
}

function beginRun_() {
  try {
    return withLock_(function () {
      const t = Number(P.getProperty('RUNNING') || 0);
      if (Date.now() - t < 6 * 60e3) return false;
      P.setProperty('RUNNING', String(Date.now()));
      return true;
    }, 3000) === true;
  } catch (e) { return false; }                       // 잠금을 못 잡으면 이번 분은 건너뜀
}

function endRun_() { try { P.deleteProperty('RUNNING'); } catch (e) {} }

/** 오늘 호 초안: 읽기 → 오늘 메시지 저장 → 기존 팀원(전환 기간)·담당자 사본 → 구독자 전원 → 초안에 결과 */
function processDraft_(today, deadline) {
  const draft = findDraft_(today, '대기') || findDraft_(today, '즉시');
  if (!draft) return;
  const msg = draft.getMessage();
  const body = msg.getPlainBody();
  let payload;
  try {
    payload = parsePayload_(draftPayloadText_(msg, 'AXKAKAO1'), today);
  } catch (e) {
    finish_(draft, msg, body, today, '실패', { error: '메시지 점검 실패: ' + e.message });
    return;
  }
  saveMsg_(today, payload.template_object);          // 이 시점부터 '오늘 호 발송됨' — 새 구독자는 오늘 호를 받음
  const result = { subscribers_total: 0, subscribers_ok: 0, friends_total: 0, success: 0, failed: [], memo: null };
  if (P.getProperty('SENDING_DATE') !== today) {
    P.setProperty('SENDING_DATE', today);
    try { legacySend_(payload.template_object, result); }
    catch (e) { result.legacy_error = errText_(e); log_('기존 팀원·담당자 사본 오류: ' + result.legacy_error); }
  } else {
    result.note = '이전 실행이 도중에 멈춰 기존 팀원(친구에게 보내기)은 중복을 피하려고 다시 보내지 않았습니다.';
  }
  deliverPending_(today, deadline);
  for (let n = 0; n < 2 && Date.now() + 60e3 < deadline && anyDue_(today, true); n++) {
    Utilities.sleep(20000);
    deliverPending_(today, deadline);
  }
  const subs = allSubs_().filter(function (s) { return s.status === 'active'; });
  const got = subs.filter(function (s) { return s.last === today; });
  result.subscribers_total = subs.length;
  result.subscribers_ok = got.length;
  result.success = got.length + (result.friends_success || 0);
  subs.filter(function (s) { return s.last !== today; }).forEach(function (s) {
    result.failed.push({ name: s.name, error: s.err || '아직 보내지 못함(1분 안에 다시 보냄)' });
  });
  const dayAgo = Date.now() - 24 * 3600e3;
  const fresh = subs.filter(function (s) { return (s.at || 0) > dayAgo; }).map(function (s) { return s.name; });
  if (fresh.length) result.subscribers_new = fresh.slice(0, 20);
  const ok = result.failed.length === 0 && (result.subscribers_total + result.friends_total) > 0;
  finish_(draft, msg, body, today, ok ? '완료' : '실패', result);
}

function findDraft_(date, state) {
  const subject = CONFIG.SUBJECT_PREFIX + ' ' + date + ' ' + state;
  const drafts = GmailApp.getDrafts();
  for (let i = 0; i < drafts.length; i++) {
    if (drafts[i].getMessage().getSubject().trim() === subject) return drafts[i];
  }
  return null;
}

function parsePayload_(body, today) {
  // 초안 본문 = "AXKAKAO1 " + base64(JSON). Gmail이 링크를 바꾸지 않도록 base64로 감싸 전달한다.
  const m = /AXKAKAO1\s+([A-Za-z0-9+\/=\s]+)/.exec(body);
  if (!m) throw new Error('본문에 AXKAKAO1 메시지가 없습니다.');
  const raw = Utilities.newBlob(Utilities.base64Decode(m[1].replace(/\s+/g, ''))).getDataAsString('UTF-8');
  const p = JSON.parse(raw);
  if (p.schema !== 'ax-kakao/1') throw new Error('schema가 ax-kakao/1이 아닙니다.');
  if (p.date !== today) throw new Error('오늘(' + today + ') 메시지가 아닙니다: ' + p.date);
  checkTemplate_(p.template_object);
  return p;
}

function checkTemplate_(t) {
  t = t || {};
  if (t.object_type !== 'text') throw new Error('텍스트 템플릿이 아닙니다.');
  if (!t.text || t.text.length > CONFIG.MAX_TEXT) throw new Error('본문 길이가 0이거나 ' + CONFIG.MAX_TEXT + '자를 넘습니다.');
  [t.link && t.link.web_url, t.link && t.link.mobile_web_url].forEach(function (u) {
    const m = /^https:\/\/([^\/?#]+)/.exec(u || '');
    if (!m || CONFIG.ALLOWED_HOSTS.indexOf(m[1].toLowerCase()) < 0) throw new Error('허용되지 않은 링크: ' + u);
  });
  return t;
}

function finish_(draft, msg, body, today, state, result) {
  result.status = state;
  result.at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const subject = CONFIG.SUBJECT_PREFIX + ' ' + today + ' ' + state;
  const to = msg.getTo() || Session.getEffectiveUser().getEmail();
  draft.update(to, subject, body.trim() + '\n\nRESULT ' + JSON.stringify(result));
  P.setProperty('LAST_DONE_DATE', today);
  log_(today + ' ' + state + ' 구독자 ' + (result.subscribers_ok || 0) + '/' + (result.subscribers_total || 0) +
    ' 기존팀원 ' + (result.friends_success || 0) + '/' + (result.friends_total || 0) + (result.error ? ' 오류=' + result.error : ''));
}

/* ───────────── 구독자 ('나에게 보내기') ───────────── */

function subKey_(id) { return 'SUB_' + id; }
function getSub_(id) { try { const v = P.getProperty(subKey_(id)); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function putSub_(s) { P.setProperty(subKey_(s.id), JSON.stringify(s)); }
function allSubs_(props) {
  const all = props || P.getProperties();
  const out = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('SUB_') !== 0) return;
    try { out.push(JSON.parse(all[k])); } catch (e) {}
  });
  return out;
}

/** 저장해 둔 날짜별 메시지 (최근 7일치) */
function msgLog_(props) {
  try { return JSON.parse((props ? props.MSG_LOG : P.getProperty('MSG_LOG')) || '{}'); } catch (e) { return {}; }
}
function saveMsg_(date, tpl) {
  const log = msgLog_();
  log[date] = tpl;
  const out = {};
  Object.keys(log).sort().slice(-7).forEach(function (d) { out[d] = log[d]; });
  P.setProperty('MSG_LOG', JSON.stringify(out));
}

/** 이 구독자가 지금 받아야 할 호의 날짜 (없으면 null) */
function wantDate_(s, log, today) {
  if (s.status !== 'active') return null;
  let want = log[today] ? today : null;
  if (s.owe && (!want || s.owe > want)) want = s.owe;
  if (!want || (s.last && s.last >= want)) return null;
  return want;
}

function claimed_(s, now) {
  if (s.claim && now - s.claim.t < 5 * 60e3) return true;          // 다른 실행이 보내는 중
  return !!(s.tries && s.errAt && now - s.errAt < 15e3 * s.tries.n); // 방금 실패 → 잠깐 쉬었다가 다시
}
function triesLeft_(s, today) { return !(s.tries && s.tries.d === today && s.tries.n >= CONFIG.MAX_TRIES); }

/** tick 앞단의 가벼운 확인: 보낼 구독자가 있는가 (속성 한 번 읽기). ignoreBackoff면 잠깐 쉬는 중인 사람도 셈 */
function anyDue_(today, ignoreBackoff) {
  const props = P.getProperties();
  const log = msgLog_(props), now = Date.now() + (ignoreBackoff ? 60e3 : 0);
  return allSubs_(props).some(function (s) {
    return wantDate_(s, log, today) && !claimed_(s, now) && triesLeft_(s, today);
  });
}

/** 받아야 할 호를 아직 못 받은 구독자에게 보낸다 (오늘 호, 가입 직후 실패한 호). 여러 실행이 겹쳐도 한 사람에게 두 번 보내지 않음 */
function deliverPending_(today, deadline) {
  const stats = { sent: 0, failed: 0 };
  for (let round = 0; round < 100 && Date.now() < deadline; round++) {
    const log = msgLog_();
    const batch = withLock_(function () {
      const now = Date.now(), due = [];
      allSubs_().forEach(function (s) {
        if (due.length >= CONFIG.BATCH) return;
        const want = wantDate_(s, log, today);
        if (!want || claimed_(s, now) || !triesLeft_(s, today)) return;
        s.claim = { d: want, t: now };
        putSub_(s);
        due.push({ s: s, want: want });
      });
      return due;
    });
    if (!batch || !batch.length) break;
    sendBatch_(batch, today, log, stats);
  }
  return stats;
}

function sendBatch_(batch, today, log, stats) {
  const res = batch.map(function () { return {}; });
  const refs = fetchAll_(batch.map(function (b) {
    return { url: KAUTH + '/oauth/token', method: 'post', muteHttpExceptions: true, payload: tokenParams_({ grant_type: 'refresh_token', refresh_token: b.s.rt }) };
  }));
  const sends = [];
  const tplCache = {};
  batch.forEach(function (b, i) {
    const r = refs[i];
    if (r.code === 200 && r.json.access_token) {
      if (r.json.refresh_token) res[i].rt = r.json.refresh_token;     // 만료 1개월 전부터 새 토큰이 옴 → 바로 교체 저장
      try {
        if (!tplCache[b.want]) tplCache[b.want] = messageFor_(b.want, today, log);
        sends.push({ i: i, token: r.json.access_token, tpl: tplCache[b.want] });
      } catch (e) { res[i].err = '메시지 준비 실패: ' + errText_(e); }
    } else {
      res[i].err = '카카오 연결 갱신 실패(' + r.code + '): ' + (r.json.error_description || r.json.error || r.text).toString().slice(0, 120);
      res[i].perm = r.json.error === 'invalid_grant';                  // 연결 해제·만료 → 다시 신청해야 함
    }
  });
  const memos = fetchAll_(sends.map(function (x) {
    return { url: KAPI + '/v2/api/talk/memo/default/send', method: 'post', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + x.token }, payload: { template_object: JSON.stringify(x.tpl) } };
  }));
  memos.forEach(function (m, k) {
    const i = sends[k].i;
    if (m.code === 200) res[i].ok = true;
    else {
      res[i].err = '보내기 실패(' + m.code + '): ' + m.text.slice(0, 120);
      res[i].perm = m.json.code === -402;                               // '카카오톡 메시지 전송' 동의 철회
    }
  });
  const off = [];
  withLock_(function () {
    batch.forEach(function (b, i) {
      const s = getSub_(b.s.id);
      if (!s) return;                                                    // 그사이 해지
      const r = res[i];
      if (r.rt) s.rt = r.rt;
      s.claim = null;
      if (r.ok) {
        if (!s.last || b.want > s.last) s.last = b.want;
        if (s.owe && s.owe <= s.last) delete s.owe;
        s.err = '';
        stats.sent++;
      } else {
        s.tries = (s.tries && s.tries.d === today) ? { d: today, n: s.tries.n + 1 } : { d: today, n: 1 };
        s.err = r.err || '알 수 없는 오류';
        stats.failed++;
        if (r.perm) { s.status = 'off'; off.push(s); }
        else if (!triesLeft_(s, today)) off.push(Object.assign({ giveUp: true }, s));
      }
      putSub_(s);
    });
  });
  const bad = batch.filter(function (b, i) { return !res[i].ok; }).map(function (b) { return b.s.name + '(' + res[batch.indexOf(b)].err.slice(0, 40) + ')'; });
  log_('구독자 발송 ' + (batch.length - bad.length) + '명 보냄' + (bad.length ? ', 실패 ' + bad.join(', ') : ''));
  off.forEach(function (s) {
    notifyOwner_(s.giveUp
      ? '[' + NAME + ' 발송 실패] ' + s.name + ' 님에게 오늘 3번 보내지 못했습니다: ' + s.err + '\n내일 다시 보냅니다. showLog에서 확인하세요.'
      : '[' + NAME + ' 구독 중단] ' + s.name + ' 님의 카카오 연결이 끊겨(연결 해제 또는 메시지 동의 철회) 더 보내지 않습니다. 다시 받으려면 사이트에서 다시 신청하면 됩니다.',
      CONFIG.NEWSLETTER_URL, '사이트 열기');
  });
}

/** 날짜에 맞는 메시지: 그날 발송한 메시지(저장분) → 없으면 사이트 자료로 만듦. 지난 호는 그 호로 가는 링크 */
function messageFor_(date, today, log) {
  const base = (log || msgLog_())[date] || buildFromSite_(date);
  if (date === today) return checkTemplate_(base);
  const url = CONFIG.NEWSLETTER_URL + '/#issue-' + date;
  return checkTemplate_(Object.assign({}, base, { link: { web_url: url, mobile_web_url: url }, button_title: '이 호 보기' }));
}

/** 사이트(axdaily.site) 자료로 그 호의 카톡 메시지를 만든다 (scripts/kakao.py와 같은 형식·200자 맞춤) */
function buildFromSite_(date) {
  const r = UrlFetchApp.fetch(CONFIG.DATA_URL + '/issues/' + date + '.json', { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('사이트에서 ' + date + ' 호를 읽지 못했습니다(' + r.getResponseCode() + ').');
  const is = JSON.parse(r.getContentText());
  if (is.status !== 'final') throw new Error(date + ' 호가 정식 발행호가 아닙니다.');
  const ymd = date.split('-').map(Number);
  const wd = '일월화수목금토'.charAt(new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2])).getUTCDay());
  const head = '[' + NAME + '] ' + ymd[1] + '.' + ymd[2] + '.(' + wd + ') ' + (is.issue_no ? '제' + is.issue_no + '호' : '시범호');
  const pts = (is.key_points || []).map(function (p) { return String(p).trim(); }).filter(Boolean);
  if (!pts.length) throw new Error(date + ' 호에 주요 소식이 없습니다.');
  return {
    object_type: 'text',
    text: fitText_(head, pts, '전체 보기 ▶ ' + CONFIG.NEWSLETTER_URL.replace(/^https?:\/\//, '')),
    link: { web_url: CONFIG.NEWSLETTER_URL, mobile_web_url: CONFIG.NEWSLETTER_URL },
    button_title: '오늘 호 보기',
  };
}

function buildText_(head, pts, tail) {
  return [head, ''].concat(pts.map(function (p) { return '· ' + p; })).concat(['', tail]).join('\n');
}

/** 200자를 넘으면 긴 줄부터 같은 길이로 줄여 '…'을 붙이고, 그래도 넘으면 마지막 줄을 뺀다 (kakao.py fit와 같음) */
function fitText_(head, points, tail) {
  const pts = points.slice();
  if (buildText_(head, pts, tail).length <= CONFIG.MAX_TEXT) return buildText_(head, pts, tail);
  while (pts.length) {
    const avail = CONFIG.MAX_TEXT - buildText_(head, pts.map(function () { return ''; }), tail).length;
    for (let cap = Math.max.apply(null, pts.map(function (p) { return p.length; })); cap >= 20; cap--) {
      if (pts.reduce(function (n, p) { return n + Math.min(p.length, cap); }, 0) <= avail) {
        return buildText_(head, pts.map(function (p) { return p.length <= cap ? p : p.slice(0, cap - 1).replace(/[ ,·]+$/, '') + '…'; }), tail);
      }
    }
    pts.pop();
  }
  return buildText_(head, points.slice(0, 1), tail).slice(0, CONFIG.MAX_TEXT);
}

/** 사이트에 올라온 정식 발행호 날짜 목록 */
function siteIssueDates_() {
  const r = UrlFetchApp.fetch(CONFIG.DATA_URL + '/index.json', { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('사이트 발행 목록을 읽지 못했습니다(' + r.getResponseCode() + ').');
  return (JSON.parse(r.getContentText()).issues || []).filter(function (i) {
    return i.status === 'final' && /^\d{4}-\d{2}-\d{2}$/.test(i.date);
  }).map(function (i) { return i.date; });
}

/**
 * 가입 직후 보낼 호: 오늘 호가 이미 발송됐으면(08:00 발송을 처리한 뒤) 오늘 호, 아니면 오늘 이전의 가장 최근 호.
 * 주말·공휴일처럼 오늘 호가 없는 날은 가장 최근 호.
 */
function pickIssue_(today) {
  const log = msgLog_();
  // 오늘 호 발송을 실제로 시작했는가 (새 코드: 저장한 오늘 메시지 / 예전 코드로 보낸 날: SENDING_DATE)
  const sentToday = !!log[today] || P.getProperty('SENDING_DATE') === today;
  let dates = Object.keys(log);
  try { dates = dates.concat(siteIssueDates_()); } catch (e) { log_('사이트 발행 목록 읽기 실패: ' + errText_(e)); }
  dates = dates.filter(function (d, i, a) { return a.indexOf(d) === i && (sentToday ? d <= today : d < today); }).sort().reverse();
  for (let i = 0; i < dates.length && i < 3; i++) {
    try { return { date: dates[i], tpl: messageFor_(dates[i], today, log) }; }
    catch (e) { log_('메시지 만들기 실패 ' + dates[i] + ': ' + errText_(e)); }
  }
  return null;
}

function issueLabel_(tpl) { return String((tpl && tpl.text) || '').split('\n')[0].replace(/^\[[^\]]*\]\s*/, ''); }

function welcomeTpl_() {
  return {
    object_type: 'text',
    text: '[' + NAME + '] 구독이 시작됐습니다.\n평일 오전 8시에 그날 호 요약을 이 \'나와의 채팅\'으로 보내 드립니다. 알림은 울리지 않으니 아침에 이 방을 열어 보세요.\n\n그만 받기 ▶ 사이트 「카카오톡으로 받기」',
    link: { web_url: CONFIG.NEWSLETTER_URL, mobile_web_url: CONFIG.NEWSLETTER_URL },
    button_title: '사이트 열기',
  };
}

/** 카카오 동의를 마치고 돌아온 구독자: 저장 → 환영 메시지 → 오늘 호(발송 후) 또는 직전 호(발송 전) 바로 보내기 */
function subscribeDone_(k, t, state) {
  const token = t.access_token;
  if (!t.refresh_token) throw new Error('카카오에서 리프레시 토큰을 받지 못했습니다.');
  const sc = scopes_(token);
  if (!sc.talk) {
    return page_('동의 항목이 빠졌습니다',
      '<b>카카오톡 메시지 전송</b>에 동의해야 받을 수 있습니다. 아래 버튼을 눌러 동의 화면에서 그 항목을 선택해 주세요.',
      authorizeUrl_(state || 'join', 'talk_message'), '다시 동의하기');
  }
  const me = kapi_('get', '/v2/user/me', token).json || {};
  const id = String(me.id || '');
  if (!id) throw new Error('카카오 회원 정보를 확인하지 못했습니다.');
  kapi_('post', '/v1/user/signup', token);           // '자동 연결'을 끈 앱이면 가입 완료 처리(이미 연결된 경우 카카오가 오류로 답하고 넘어감)
  const app = k ? takeApplicant_(k) : null;
  const today = ymd_();
  const pick = pickIssue_(today);                     // 네트워크 작업은 잠금 밖에서
  const plan = withLock_(function () {
    const now = Date.now();
    let s = getSub_(id);
    const isNew = !s || s.status !== 'active';
    if (!s) s = { id: id, at: now };
    if (isNew) { s.at = now; s.tries = null; }
    s.name = (app && app.name) || s.name || ('카카오 ' + id.slice(-4));
    if (app && app.email) s.email = app.email;
    s.rt = t.refresh_token;
    s.status = 'active';
    s.err = '';
    let send = null;
    if (pick && (!s.last || s.last < pick.date)) {
      if (!claimed_(s, now)) { s.claim = { d: pick.date, t: now }; send = pick; }
    }
    putSub_(s);
    return { isNew: isNew, send: send, name: s.name, last: s.last };
  });
  if (plan.isNew) {
    const w = memo_(token, welcomeTpl_());
    if (w.code !== 200) log_('환영 메시지 실패 ' + plan.name + ' ' + w.code + ' ' + w.text.slice(0, 100));
  }
  let sent = false, err = '';
  if (plan.send) {
    const r = memo_(token, plan.send.tpl);
    sent = r.code === 200;
    if (!sent) err = '보내기 실패(' + r.code + '): ' + r.text.slice(0, 120);
  }
  withLock_(function () {
    const s = getSub_(id);
    if (!s) return;
    s.claim = null;
    if (plan.send) {
      if (sent) { if (!s.last || plan.send.date > s.last) s.last = plan.send.date; if (s.owe && s.owe <= s.last) delete s.owe; }
      else { s.owe = plan.send.date; s.err = err; }  // tick이 몇 분 안에 다시 보냄
    }
    putSub_(s);
  });
  const label = plan.send ? issueLabel_(plan.send.tpl) : '';
  log_('구독 ' + plan.name + (plan.isNew ? ' (새로)' : ' (다시 동의)') + (plan.send ? ' / ' + plan.send.date + ' ' + (sent ? '보냄' : err) : ' / 보낼 호 없음'));
  if (plan.isNew) {
    const n = allSubs_().filter(function (s) { return s.status === 'active'; }).length;
    notifyOwner_('[' + NAME + ' 구독] ' + plan.name + ' 님이 카카오톡 받기를 시작했습니다. 지금 구독자 ' + n + '명.' +
      (plan.send ? '\n가입 직후 ' + label + (sent ? '을(를) 보냈습니다.' : ' 발송 실패, 몇 분 안에 다시 보냅니다.') : ''), CONFIG.NEWSLETTER_URL, '사이트 열기');
  }
  const where = '카카오톡 <b>나와의 채팅</b>';
  if (!plan.isNew && !plan.send) {
    return page_('이미 받고 계십니다', '평일 오전 8시에 ' + where + '으로 <b>' + esc_(NAME) + '</b>를 보내 드리고 있습니다.');
  }
  const first = plan.send
    ? (sent ? '방금 ' + where + '으로 <b>' + esc_(label) + '</b>를 보냈습니다.' : esc_(label) + '는 몇 분 안에 ' + where + '으로 보내 드립니다.')
    : '다음 발행 호부터 ' + where + '으로 보내 드립니다.';
  return page_(plan.isNew ? '구독 완료' : '다시 연결했습니다', first + '<br>앞으로 평일 오전 8시마다 같은 곳으로 보내 드립니다.<br><small>카톡 알림은 울리지 않습니다. 그만 받으려면 사이트의 「카카오톡으로 받기」 창에서 해지할 수 있습니다.</small>');
}

/** 그만 받기: 본인 확인 후 앱 연결 끊기 → 구독자 명단에서 삭제 */
function leaveDone_(token) {
  const me = kapi_('get', '/v2/user/me', token).json || {};
  const id = String(me.id || '');
  if (id && id === ownerId_()) return page_('해지할 수 없습니다', '발신 계정(담당자)은 여기서 해지할 수 없습니다.');
  const s = id ? getSub_(id) : null;
  const r = kapi_('post', '/v1/user/unlink', token);
  if (r.code !== 200) return page_('해지하지 못했습니다', '카카오 응답: ' + esc_(r.text.slice(0, 200)) + '<br>담당자에게 알려 주세요.');
  if (id) withLock_(function () { P.deleteProperty(subKey_(id)); });
  const who = s ? s.name : '카카오 회원번호 ' + id;
  log_('해지 ' + who);
  notifyOwner_('[' + NAME + ' 해지] ' + who + ' 님이 카카오톡 받기를 그만했습니다(앱 연결 해제).', CONFIG.NEWSLETTER_URL, '사이트 열기');
  return page_('그만 받기 완료', '이제 ' + esc_(NAME) + ' 카카오톡이 가지 않습니다. 다시 받으려면 사이트에서 다시 신청해 주세요.');
}

/* ───────────── 신청 (사이트 '카카오톡으로 받기' 창 → doPost, 예비: 이 웹 앱 주소) ───────────── */

function apps_() { try { return JSON.parse(P.getProperty('APPLICANTS') || '[]'); } catch (e) { return []; } }
function saveApps_(a) {
  const weekAgo = Date.now() - 7 * 86400e3;
  P.setProperty('APPLICANTS', JSON.stringify(a.filter(function (x) { return x.at > weekAgo && x.k; }).slice(-50)));
}

/** 신청 저장 후 카카오 동의 주소를 돌려준다. 이메일은 선택(예전 신청 창 호환) */
function applySubmit(form) {
  form = form || {};
  const name = String(form.name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  const email = String(form.email || '').trim().toLowerCase();
  if (!name) return { ok: false, msg: '이름을 적어 주세요.' };
  if (email && (email.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { ok: false, msg: '이메일 형식을 확인해 주세요.' };
  if (form.agree !== true) return { ok: false, msg: '아래 안내에 동의해 주세요.' };
  const r = withLock_(function () {
    const a = apps_(), now = Date.now();
    if (a.filter(function (y) { return now - y.at < 3600e3; }).length >= CONFIG.APPLY_PER_HOUR) return null;
    const x = { k: Utilities.getUuid().replace(/-/g, '').slice(0, 12), name: name, email: email, at: now };
    a.push(x);
    saveApps_(a);
    return x;
  });
  if (!r) return { ok: false, msg: '지금은 신청이 몰려 잠시 받지 않습니다. 1시간 뒤 다시 시도해 주세요.' };
  log_('신청 ' + name);
  return { ok: true, active: false, mode: 'memo', url: authorizeUrl_('apply:' + r.k, 'talk_message') };
}

function takeApplicant_(k) {
  return withLock_(function () {
    const a = apps_();
    const x = a.filter(function (y) { return y.k === k; })[0] || null;
    if (x) saveApps_(a.filter(function (y) { return y.k !== k; }));
    return x;
  });
}

/* ───────────── 기존 팀원(전환 기간) · 담당자 사본 ───────────── */

function legacySend_(tpl, result) {
  const token = accessToken_();
  const subIds = {};
  allSubs_().forEach(function (s) { if (s.status === 'active') subIds[String(s.id)] = true; });
  const ownerId = ownerId_(token);
  let friends = [];
  if (CONFIG.LEGACY_FRIENDS) {
    try {
      friends = listFriends_(token).filter(function (f) { return f.allowed_msg !== false && !subIds[String(f.id)]; });
    } catch (e) { result.friends_error = errText_(e).slice(0, 200); }   // 기존 팀원이 없으면 오류가 날 수 있음 — 구독자 발송과 무관
  }
  result.friends_total = friends.length;
  result.friends_success = 0;
  const t = JSON.stringify(tpl);
  for (let i = 0; i < friends.length; i += 5) {
    const chunk = friends.slice(i, i + 5);
    const r = kapi_('post', '/v1/api/talk/friends/message/default/send', token, {
      receiver_uuids: JSON.stringify(chunk.map(function (f) { return f.uuid; })), template_object: t,
    });
    const okIds = r.code === 200 ? (r.json.successful_receiver_uuids || []) : [];
    result.friends_success += okIds.length;
    chunk.forEach(function (f) {
      if (okIds.indexOf(f.uuid) < 0) result.failed.push({ name: (f.profile_nickname || '') + '(기존 팀원)', error: r.code === 200 ? JSON.stringify(r.json.failure_info || '') : r.text.slice(0, 200) });
    });
  }
  if (friends.length) result.legacy_names = friends.map(function (f) { return f.profile_nickname || ''; }).slice(0, 20);
  if (CONFIG.SEND_TO_ME && !(ownerId && subIds[ownerId])) {
    const m = kapi_('post', '/v2/api/talk/memo/default/send', token, { template_object: t });
    result.memo = m.code === 200;
  }
}

function listFriends_(token) {
  const out = [];
  let offset = 0;
  for (let n = 0; n < 10; n++) {
    const r = kapi_('get', '/v1/api/talk/friends?limit=100&offset=' + offset, token);
    if (r.code !== 200) throw new Error('친구 목록 조회 실패(' + r.code + '): ' + r.text.slice(0, 300));
    const el = r.json.elements || [];
    Array.prototype.push.apply(out, el);
    if (!r.json.after_url || el.length === 0) break;
    offset += el.length;
  }
  return out;
}

/* ───────────── 카카오 API ───────────── */

function key_(name) { return String(P.getProperty(name) || '').trim(); }

function tokenParams_(params) {
  const key = key_('KAKAO_REST_API_KEY');
  if (!key) throw new Error('프로젝트 설정 > 스크립트 속성에 KAKAO_REST_API_KEY를 넣으세요.');
  params.client_id = key;
  const secret = key_('KAKAO_CLIENT_SECRET');
  if (secret) params.client_secret = secret;
  return params;
}

function tokenRequest_(params) {
  const res = UrlFetchApp.fetch(KAUTH + '/oauth/token', { method: 'post', payload: tokenParams_(params), muteHttpExceptions: true });
  let json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  if (res.getResponseCode() !== 200) {
    const err = new Error('토큰 발급 실패: ' + res.getContentText().slice(0, 300));
    err.kakao = json;
    throw err;
  }
  return json;
}

function kapi_(method, path, token, payload) {
  const opt = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } };
  if (payload) opt.payload = payload;
  const res = UrlFetchApp.fetch(KAPI + path, opt);
  const text = res.getContentText();
  let json = {};
  try { json = JSON.parse(text); } catch (e) {}
  return { code: res.getResponseCode(), text: text, json: json };
}

function fetchAll_(reqs) {
  if (!reqs.length) return [];
  return UrlFetchApp.fetchAll(reqs).map(function (res) {
    const text = res.getContentText();
    let json = {};
    try { json = JSON.parse(text); } catch (e) {}
    return { code: res.getResponseCode(), text: text, json: json };
  });
}

function memo_(token, tpl) {
  return kapi_('post', '/v2/api/talk/memo/default/send', token, { template_object: JSON.stringify(tpl) });
}

function scopes_(token) {
  const sc = (kapi_('get', '/v2/user/scopes', token).json || {}).scopes || [];
  const ag = function (id) { return sc.some(function (s) { return s.id === id && s.agreed; }); };
  return { talk: ag('talk_message'), friends: ag('friends') };
}

/** 담당자(발신 연결 계정) 액세스 토큰 — 담당자 알림·기존 팀원 발송용. 구독자 발송에는 쓰지 않음 */
let OWNER_AT_ = null;
function accessToken_() {
  if (OWNER_AT_ && OWNER_AT_.exp - Date.now() > 3600e3) return OWNER_AT_.token;
  try {
    const c = JSON.parse(P.getProperty('OWNER_AT') || 'null');
    if (c && c.exp - Date.now() > 3600e3) { OWNER_AT_ = c; return c.token; }
  } catch (e) {}
  const refresh = P.getProperty('OWNER_REFRESH_TOKEN');
  if (!refresh) throw new Error('발신자 카카오 연결이 없습니다. 웹 앱 주소에 ?owner=<OWNER_KEY>를 붙여 연결하세요.');
  const t = tokenRequest_({ grant_type: 'refresh_token', refresh_token: refresh });
  if (t.refresh_token) P.setProperty('OWNER_REFRESH_TOKEN', t.refresh_token);
  P.setProperty('OWNER_REFRESHED_AT', new Date().toISOString());
  OWNER_AT_ = { token: t.access_token, exp: Date.now() + (Number(t.expires_in) || 21599) * 1000 };
  P.setProperty('OWNER_AT', JSON.stringify(OWNER_AT_));
  return t.access_token;
}

function ownerId_(token) {
  let id = P.getProperty('OWNER_ID');
  if (!id) {
    try { id = String((kapi_('get', '/v2/user/me', token || accessToken_()).json || {}).id || ''); if (id) P.setProperty('OWNER_ID', id); } catch (e) { id = ''; }
  }
  return id;
}

function redirectUri_() { return CONFIG.REDIRECT_URI || ScriptApp.getService().getUrl(); }

function authorizeUrl_(state, scope) {
  const key = key_('KAKAO_REST_API_KEY');
  if (!key) throw new Error('프로젝트 설정 > 스크립트 속성에 KAKAO_REST_API_KEY를 넣으세요.');
  if (scope === undefined) scope = 'talk_message';
  return KAUTH + '/oauth/authorize?response_type=code' +
    '&client_id=' + encodeURIComponent(key) +
    '&redirect_uri=' + encodeURIComponent(redirectUri_()) +
    (scope ? '&scope=' + encodeURIComponent(scope) : '') +
    '&state=' + encodeURIComponent(state);
}

/** 담당자 '나와의 채팅'으로 알림 (실패해도 흐름은 계속) */
function notifyOwner_(text, url, button, token) {
  try {
    const r = kapi_('post', '/v2/api/talk/memo/default/send', token || accessToken_(), {
      template_object: JSON.stringify({ object_type: 'text', text: text.slice(0, 200), link: { web_url: url, mobile_web_url: url }, button_title: button }),
    });
    if (r.code !== 200) log_('담당자 알림 실패 ' + r.code + ' ' + r.text.slice(0, 120));
  } catch (e) { log_('담당자 알림 실패 ' + errText_(e)); }
}

/* ───────────── 웹 앱 (카카오 로그인 연결 · 사이트 신청 창) ───────────── */

function doGet(e) {
  const q = (e && e.parameter) || {};
  if (q.error) {
    if (/^(apply:\w+|join)$/.test(q.state || '')) {
      return page_('동의가 끝나지 않았습니다', '카카오 동의 화면에서 취소했거나 오류가 났습니다(' + esc_(q.error_description || q.error) + ').<br>아래 버튼으로 다시 동의해 주세요.',
        authorizeUrl_(q.state, 'talk_message'), '다시 동의하기');
    }
    return page_('연결되지 않았습니다', '카카오에서 동의를 취소했거나 오류가 났습니다: ' + esc_(q.error_description || q.error));
  }
  if (q.code) {
    let t;
    try {
      t = tokenRequest_({ grant_type: 'authorization_code', redirect_uri: redirectUri_(), code: q.code });
    } catch (err) {
      if (err.kakao && err.kakao.error === 'invalid_grant') {
        return page_('이미 처리된 요청입니다', '이 화면을 새로 고쳤거나 뒤로 가기로 다시 열린 것 같습니다. 카카오톡 <b>나와의 채팅</b>을 확인해 주세요.<br>안 왔으면 사이트에서 다시 신청해 주세요.');
      }
      log_('카카오 연결 실패 ' + errText_(err));
      return page_('연결 실패', esc_(errText_(err)));
    }
    try {
      const ownerKey = P.getProperty('OWNER_KEY');
      if (ownerKey && q.state === 'owner:' + ownerKey) {
        if (!scopes_(t.access_token).talk) {
          return page_('동의 항목이 빠졌습니다',
            '<b>카카오톡 메시지 전송</b>에 동의해야 담당자 알림·시험 메시지를 받을 수 있습니다. 아래 버튼을 눌러 동의 화면에서 그 항목을 꼭 선택해 주세요.',
            authorizeUrl_('owner:' + ownerKey, 'talk_message'), '다시 동의하기');
        }
        P.setProperty('OWNER_REFRESH_TOKEN', t.refresh_token);
        P.setProperty('OWNER_REFRESHED_AT', new Date().toISOString());
        P.deleteProperty('OWNER_ID');
        P.deleteProperty('OWNER_AT');
        OWNER_AT_ = null;
        let friends = [];
        try { friends = listFriends_(t.access_token); } catch (fe) { log_('친구 목록 조회 실패: ' + fe.message); }
        log_('발신자 연결 완료, 기존 팀원 ' + friends.length + '명');
        return page_('발신자 연결 완료', '담당자 알림과 사본을 이 카카오 계정의 나와의 채팅으로 보냅니다.<br>구독자 ' +
          allSubs_().filter(function (s) { return s.status === 'active'; }).length + '명, 기존 팀원(친구에게 보내기) ' + friends.length + '명.');
      }
      if (/^apply:\w+$/.test(q.state || '')) return subscribeDone_(q.state.slice(6), t, q.state);
      if (q.state === 'leave') return leaveDone_(t.access_token);
      return subscribeDone_(null, t, 'join');           // 예전 팀원 동의 주소(?p=member)·이름 없는 가입
    } catch (err) {
      log_('구독 처리 오류 ' + errText_(err));
      return page_('처리하지 못했습니다', esc_(errText_(err)) + '<br>잠시 뒤 사이트에서 다시 신청해 주세요.');
    }
  }
  const ownerKey = P.getProperty('OWNER_KEY');
  if (q.owner && ownerKey && q.owner === ownerKey) {
    return page_('발신자 카카오 연결', '담당자 알림·사본을 받을 본인 카카오 계정으로 로그인하고 동의해 주세요.',
      authorizeUrl_('owner:' + ownerKey, CONFIG.LEGACY_FRIENDS ? 'talk_message,friends' : 'talk_message'), '카카오로 연결');
  }
  if (q.p === 'leave') {
    return page_('카카오톡 받기 그만하기', '카카오 로그인으로 본인을 확인한 뒤 이 서비스와의 연결을 끊습니다. 다음 날부터 메시지가 가지 않습니다.',
      authorizeUrl_('leave', ''), '카카오로 확인하고 그만 받기');
  }
  if (q.p === 'member') {
    return page_(NAME + ' 카카오톡 받기', '아래 버튼으로 카카오 로그인 후 <b>카카오톡 메시지 전송</b>에 동의하면 바로 받기 시작합니다.',
      authorizeUrl_('join', 'talk_message'), '카카오로 동의하기');
  }
  return applyPage_();
}

/* 사이트(axdaily.site) 신청 창이 부르는 주소 (POST, 본문 JSON)
 * {act:'apply', name, agree} → {ok, msg, mode:'memo', url(카카오 동의 주소)}
 * {act:'leave'} → {ok, url(본인 확인 후 연결 끊기용 카카오 주소)}   {act:'ping'} → {ok:true, mode:'memo'} */
function doPost(e) {
  let q = {};
  try { q = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {}; } catch (x) { q = {}; }
  let out;
  try {
    if (q.act === 'apply') out = applySubmit({ name: q.name, email: q.email, agree: q.agree === true });
    else if (q.act === 'leave') out = { ok: true, url: authorizeUrl_('leave', '') };
    else if (q.act === 'ping') out = { ok: true, mode: 'memo' };
    else out = { ok: false, msg: '알 수 없는 요청입니다.' };
  } catch (err) {
    log_('사이트 요청 오류 ' + errText_(err));
    out = { ok: false, msg: '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function applyPage_() {
  const leaveUrl = redirectUri_() + '?p=leave';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
  body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#222;background:#fff;word-break:keep-all}
  main{max-width:460px;margin:0 auto;padding:36px 20px 48px}
  h1{margin:0;font-size:24px;line-height:1.3;color:#111}
  .lead{margin:8px 0 24px;color:#5C6366}
  label{display:block;margin:18px 0 6px;font-weight:700;color:#111}
  input[type=text]{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:12px 14px;border:1px solid #C9CFCF;border-radius:8px}
  input:focus{outline:2px solid #007B66;outline-offset:1px;border-color:#007B66}
  .agree{display:flex;gap:10px;align-items:flex-start;margin:20px 0 0;font-size:14px;color:#333}
  .agree input{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:#007B66}
  button{width:100%;min-height:50px;margin-top:22px;font:inherit;font-weight:700;color:#fff;background:#007B66;border:0;border-radius:8px;cursor:pointer}
  button[disabled]{opacity:.55;cursor:default}
  .msg{min-height:1.6em;margin:12px 0 0;font-size:14px;color:#C0201B}
  .kakao{display:block;text-align:center;margin-top:18px;padding:15px 18px;border-radius:8px;background:#FEE500;color:#191919;font-weight:700;text-decoration:none}
  .steps{margin:18px 0 0;padding-left:20px;color:#333}
  .steps li{margin:4px 0}
  .done{display:inline-block;margin:0 0 6px;font-size:13px;font-weight:700;color:#007B66}
  .foot{margin-top:32px;padding-top:16px;border-top:1px solid #E6E9E9;font-size:13px;color:#5C6366}
  .foot a{color:#111}
</style></head><body><main>
<section id="s1">
  <h1>${esc_(NAME)}<br>카카오톡으로 받기</h1>
  <p class="lead">평일 오전 8시, 그날 호 요약을 카카오톡 '나와의 채팅'으로 보내 드립니다.</p>
  <form id="f" novalidate>
    <label for="nm">이름</label>
    <input id="nm" type="text" maxlength="20" autocomplete="name" required>
    <div class="agree"><input id="ag" type="checkbox"><label for="ag" style="margin:0;font-weight:400">이름을 발송 등록에만 쓰는 데 동의합니다. 그만 받으면 지웁니다.</label></div>
    <button id="go" type="submit">신청하고 카카오 동의로 넘어가기</button>
    <p class="msg" id="msg" role="alert"></p>
  </form>
</section>
<section id="s2" hidden>
  <p class="done">신청서 접수 완료</p>
  <h1>마지막으로 카카오 동의</h1>
  <ol class="steps">
    <li>아래 노란 버튼으로 카카오 로그인합니다.</li>
    <li><b>카카오톡 메시지 전송</b>에 동의합니다.</li>
    <li>바로 '나와의 채팅'으로 최신 호가 옵니다.</li>
  </ol>
  <a class="kakao" id="kk" href="#" target="_top">카카오로 동의하기</a>
</section>
<p class="foot">메시지는 카카오톡 '나와의 채팅'에 알림 없이 쌓입니다.<br>그만 받으려면 <a href="${esc_(leaveUrl)}" target="_top">여기</a>를 누르세요.</p>
</main>
<script>
(function () {
  var f = document.getElementById('f'), go = document.getElementById('go'), msg = document.getElementById('msg');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.textContent = '';
    go.disabled = true; go.textContent = '보내는 중…';
    google.script.run
      .withSuccessHandler(function (r) {
        go.disabled = false; go.textContent = '신청하고 카카오 동의로 넘어가기';
        if (!r || !r.ok) { msg.textContent = (r && r.msg) || '신청하지 못했습니다. 다시 시도해 주세요.'; return; }
        document.getElementById('s1').hidden = true;
        document.getElementById('kk').href = r.url;
        document.getElementById('s2').hidden = false;
      })
      .withFailureHandler(function () {
        go.disabled = false; go.textContent = '신청하고 카카오 동의로 넘어가기';
        msg.textContent = '연결이 불안정합니다. 잠시 뒤 다시 눌러 주세요.';
      })
      .applySubmit({ name: document.getElementById('nm').value, agree: document.getElementById('ag').checked });
  });
})();
</script></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle(NAME + ' 카카오톡 신청').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function page_(title, html, url, button) {
  const btn = url ? '<p><a href="' + esc_(url) + '" target="_top" style="display:inline-block;background:#FEE500;color:#191919;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700">' + esc_(button) + '</a></p>' : '';
  const out = HtmlService.createHtmlOutput(
    '<div style="font-family:-apple-system,\'Malgun Gothic\',sans-serif;max-width:480px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222;word-break:keep-all">' +
    '<h2 style="margin:0 0 12px">' + esc_(title) + '</h2><p>' + html + '</p>' + btn +
    '<p style="margin-top:28px;font-size:14px"><a href="' + esc_(CONFIG.NEWSLETTER_URL) + '" target="_top" style="color:#007B66">' + esc_(NAME) + '로 돌아가기</a></p></div>');
  out.setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return out;
}

/* ───────────── 공통 ───────────── */

function withLock_(fn, wait) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(wait || 20000)) throw new Error('잠시 처리 중입니다. 잠시 뒤 다시 시도해 주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function errText_(e) { return String((e && e.message) || e); }

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function log_(line) {
  let logs = [];
  try { logs = JSON.parse(P.getProperty('LOG') || '[]'); } catch (e) {}
  logs.unshift(Utilities.formatDate(new Date(), TZ, 'MM-dd HH:mm') + ' ' + String(line).slice(0, 180));
  P.setProperty('LOG', JSON.stringify(logs.slice(0, 40)));
  console.log(line);
}

/* ───────────── 편집기에서 직접 실행하는 함수 ───────────── */

/** 처음 한 번(또는 코드를 바꾼 뒤) 실행: 1분 트리거 확인, REST API 키 저장, 발신자 연결 주소를 로그에 보여 준다 */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  let key = P.getProperty('OWNER_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '').slice(0, 16); P.setProperty('OWNER_KEY', key); }
  console.log('REST API 키: ' + (key_('KAKAO_REST_API_KEY') ? '저장됨' : '없음 — 프로젝트 설정 > 스크립트 속성에 넣고 다시 실행'));
  GmailApp.getDrafts(); // Gmail 권한 확인
  const url = redirectUri_();
  console.log('1분 트리거 설치 완료');
  console.log('카카오 Redirect URI에 등록할 주소: ' + (url || '(먼저 웹 앱으로 배포하세요)'));
  console.log('발신자 연결 주소(본인만 여세요): ' + (url ? url + '?owner=' + key : '(배포 후 다시 실행)'));
  console.log('구독 신청: ' + SITE + ' 의 「카카오톡으로 받기」');
}

/** 지금 누가 가입하면 어떤 호가 바로 가는지 미리 보기 (메시지를 보내지 않음) */
function previewSignup() {
  const today = ymd_();
  const p = pickIssue_(today);
  console.log('오늘 ' + today + ' ' + hm_() + ' / 오늘 호 발송 시작됨: ' + (!!msgLog_()[today] || P.getProperty('SENDING_DATE') === today));
  if (!p) { console.log('보낼 호를 찾지 못했습니다(사이트 자료 확인).'); return; }
  console.log('가입 직후 보낼 호: ' + p.date + ' (' + p.tpl.text.length + '자)\n' + p.tpl.text + '\n링크: ' + p.tpl.link.web_url);
}

/** 구독자 목록 (메시지를 보내지 않음) */
function listSubscribers() {
  const subs = allSubs_();
  const act = subs.filter(function (s) { return s.status === 'active'; });
  console.log('구독자 ' + act.length + '명 (중단 ' + (subs.length - act.length) + '명)');
  subs.forEach(function (s) {
    console.log('- ' + s.name + ' / ' + s.status + ' / 마지막으로 받은 호 ' + (s.last || '없음') + (s.err ? ' / 최근 오류: ' + s.err : '') +
      ' / 가입 ' + Utilities.formatDate(new Date(s.at || 0), TZ, 'yyyy-MM-dd HH:mm'));
  });
}

/** 담당자 '나와의 채팅'으로 시험 메시지 1통 */
function testToMe() {
  const r = memo_(accessToken_(), { object_type: 'text', text: '[시험] ' + NAME + ' 카카오톡 발송기 연결 확인 (구독자 ' + allSubs_().filter(function (s) { return s.status === 'active'; }).length + '명)',
    link: { web_url: CONFIG.NEWSLETTER_URL, mobile_web_url: CONFIG.NEWSLETTER_URL }, button_title: '사이트 열기' });
  console.log('나에게 보내기 결과: ' + r.code + ' ' + r.text);
}

/** 발신자 카카오 계정이 동의한 항목 확인 */
function checkScopes() {
  const r = kapi_('get', '/v2/user/scopes', accessToken_());
  (r.json.scopes || []).forEach(function (s) { console.log(s.id + ' : ' + (s.agreed ? '동의함' : '동의 안 함') + (s.using ? '' : ' (앱에서 사용 안 함)')); });
  if (r.code !== 200) console.log(r.code + ' ' + r.text);
}

/** 시험: 요일·시각 조건 없이 오늘 '대기' 초안을 실제 경로대로 처리 */
function testPipelineNow() {
  const today = ymd_();
  P.deleteProperty('LAST_DONE_DATE');
  const before = P.getProperty('SENDING_DATE');
  if (!findDraft_(today, '대기') && !findDraft_(today, '즉시')) { console.log('오늘 대기 초안 없음'); return; }
  if (before === today) console.log('오늘 이미 기존 팀원 발송을 시작한 기록이 있어 기존 팀원에게는 다시 보내지 않습니다(구독자는 받은 사람 빼고 보냄).');
  processDraft_(today, Date.now() + CONFIG.TIME_BUDGET_MS);
  console.log((JSON.parse(P.getProperty('LOG') || '[]')).slice(0, 5).join('\n'));
}

/** 오늘 발송 기록을 지움: 오늘 실패한 뒤 원인을 고치고 Claude가 새 '대기' 초안을 넣었을 때만 실행 (이미 받은 구독자에게는 다시 보내지 않음) */
function resetToday() {
  P.deleteProperty('LAST_DONE_DATE');
  P.deleteProperty('SENDING_DATE');
  P.deleteProperty('RUNNING');
  console.log('오늘 기록을 지웠습니다. 다음 1분 안에 "대기" 초안이 있으면 처리합니다.');
}

/** 기존 팀원(친구에게 보내기) 목록 — 전환 기간 확인용 */
function listTeam() {
  const r = kapi_('get', '/v1/api/talk/friends?limit=100', accessToken_());
  const subIds = {};
  allSubs_().forEach(function (s) { if (s.status === 'active') subIds[String(s.id)] = true; });
  console.log('HTTP ' + r.code + ' / 기존 팀원 ' + (r.json.total_count === undefined ? '?' : r.json.total_count) + '명');
  (r.json.elements || []).forEach(function (f) {
    console.log('- ' + (f.profile_nickname || '이름 없음') + (subIds[String(f.id)] ? ' (새 방식 구독 완료 — 친구에게 보내기 안 함)' : ' (아직 다시 신청 안 함)') + (f.allowed_msg === false ? ' (메시지 수신 차단)' : ''));
  });
  if (r.code !== 200) console.log(r.text.slice(0, 400));
}

/** 최근 기록 보기 */
function showLog() {
  console.log((JSON.parse(P.getProperty('LOG') || '[]')).join('\n'));
  console.log('LAST_DONE_DATE=' + P.getProperty('LAST_DONE_DATE') + ', 담당자 토큰 갱신=' + P.getProperty('OWNER_REFRESHED_AT') +
    ', 구독자 ' + allSubs_().filter(function (s) { return s.status === 'active'; }).length + '명');
}
