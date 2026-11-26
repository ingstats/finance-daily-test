/**
 * 사이트 반영 — Claude가 Gmail 임시보관함에 둔 "[ID-SITE] YYYY-MM-DD 대기" 초안의 파일을 GitHub 저장소에 커밋한다.
 * 커밋되면 GitHub Pages가 1~2분 안에 사이트를 갱신한다. PC가 꺼져 있어도 동작한다(Google 서버에서 실행).
 *
 * 초안 본문 = "DAILYSITE1 " + base64(gzip(JSON))   JSON = {schema:'daily-site/1', date, message, files:{경로: 내용}}
 * 처리 후 초안 제목을 "완료"/"실패"로 바꾸고 본문 끝에 RESULT 한 줄을 붙인다(Claude가 읽어 확인).
 * 스크립트 속성: GITHUB_REPO(예: ingstats/finance-daily-test), GITHUB_TOKEN(이 저장소 1개 Contents 읽기·쓰기 토큰)
 */
const SITE_PREFIX = '[' + NID + '-SITE]';
const SITE_ALLOWED = /^(data\/[\w.\-\/]+\.json|indicators\.json|newsletter\.yaml|editorial\.md|index\.html)$/;

/** tick(1분)에서 부름: 06:00~23:00에 대기 초안이 있으면 처리 */
function siteTick_() {
  const hhmm = hm_();
  if (hhmm < '06:00' || hhmm > '23:00') return;
  publishDrafts_();
}

/** 편집기에서 직접 실행: 시간과 관계없이 대기 초안을 지금 처리 */
function publishSiteNow() { console.log(JSON.stringify(publishDrafts_(), null, 1)); }

function publishDrafts_() {
  const threads = GmailApp.search('in:drafts subject:"' + SITE_PREFIX + '"', 0, 20);
  if (!threads.length) return [];
  const out = [];
  GmailApp.getDrafts().forEach(function (d) {
    const msg = d.getMessage();
    const subject = msg.getSubject().trim();
    const m = new RegExp('^' + SITE_PREFIX.replace(/[\[\]\-]/g, '\\$&') + ' (\\d{4}-\\d{2}-\\d{2}) 대기$').exec(subject);
    if (!m) return;
    const body = msg.getPlainBody();
    let result;
    try { result = publishPayload_(draftPayloadText_(msg, 'DAILYSITE1')); }
    catch (e) { result = { ok: false, error: errText_(e) }; }
    d.update(msg.getTo() || Session.getEffectiveUser().getEmail(), SITE_PREFIX + ' ' + m[1] + ' ' + (result.ok ? '완료' : '실패'), body + '\nRESULT ' + JSON.stringify(result));
    log_('사이트 반영 ' + m[1] + ': ' + (result.ok ? '완료 ' + result.files.length + '개' : '실패 ' + result.error));
    if (!result.ok) notifyOwnerSafe_('[' + NAME + ' 사이트 반영 실패] ' + m[1] + ' ' + String(result.error).slice(0, 120));
    out.push(result);
  });
  return out;
}

/** 초안의 자료 본문: 첨부한 .txt 파일(권장, Claude가 파일을 그대로 첨부) → 없으면 메일 본문 */
function draftPayloadText_(msg, marker) {
  const atts = msg.getAttachments() || [];
  for (let i = 0; i < atts.length; i++) {
    const a = atts[i];
    if (!/\.txt$/i.test(a.getName() || '') && !/^text\//.test(a.getContentType() || '')) continue;
    const txt = a.getDataAsString('UTF-8');
    if (txt.indexOf(marker) >= 0) return txt;
  }
  return msg.getPlainBody();
}

function publishPayload_(body) {
  const mm = /DAILYSITE1\s+([A-Za-z0-9+\/=\s]+)/.exec(body);
  if (!mm) throw new Error('본문에 DAILYSITE1 자료가 없습니다.');
  const gz = Utilities.newBlob(Utilities.base64Decode(mm[1].replace(/\s+/g, '')), 'application/x-gzip');
  const p = JSON.parse(Utilities.ungzip(gz).getDataAsString('UTF-8'));
  if (p.schema !== 'daily-site/1') throw new Error('schema가 daily-site/1이 아닙니다.');
  const paths = Object.keys(p.files || {});
  if (!paths.length) throw new Error('올릴 파일이 없습니다.');
  paths.forEach(function (path) { if (!SITE_ALLOWED.test(path)) throw new Error('올릴 수 없는 경로: ' + path); });
  // 자료 파일을 먼저, 발행 목록(index.json)을 마지막에: 목록에 올라간 호는 항상 파일이 있게
  paths.sort(function (a, b) { return (a === 'data/index.json') - (b === 'data/index.json'); });
  const done = [];
  paths.forEach(function (path) {
    const r = ghPut_(path, p.files[path], (p.message || 'Claude 발행') + ' — ' + path);
    done.push(path + ':' + r);
  });
  return { ok: true, date: p.date, files: done };
}

/* ───────────── GitHub (Contents API) ───────────── */

function gh_() {
  const repo = String(P.getProperty('GITHUB_REPO') || '').trim(), token = String(P.getProperty('GITHUB_TOKEN') || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('스크립트 속성 GITHUB_REPO(예: owner/repo)가 없습니다.');
  if (!token) throw new Error('스크립트 속성 GITHUB_TOKEN이 없습니다.');
  return { repo: repo, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
}

function ghUrl_(repo, path) { return 'https://api.github.com/repos/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/'); }

/** 파일 읽기: {text, sha} 또는 null(없음) */
function ghGet_(path) {
  const g = gh_();
  const r = UrlFetchApp.fetch(ghUrl_(g.repo, path), { headers: g.headers, muteHttpExceptions: true });
  const exp = (r.getHeaders() || {})['github-authentication-token-expiration'] || (r.getHeaders() || {})['GitHub-Authentication-Token-Expiration'];
  if (exp && P.getProperty('GITHUB_TOKEN_EXPIRES') !== String(exp)) P.setProperty('GITHUB_TOKEN_EXPIRES', String(exp));
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('GitHub 읽기 실패 ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 160));
  const j = JSON.parse(r.getContentText());
  let text = '';
  if (j.content) text = Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\s+/g, ''))).getDataAsString('UTF-8');
  else if (j.download_url) text = UrlFetchApp.fetch(j.download_url, { headers: g.headers }).getContentText('UTF-8');
  return { text: text, sha: j.sha };
}

/** 파일 쓰기(만들기·바꾸기). 내용이 같으면 커밋하지 않음 */
function ghPut_(path, text, message) {
  const g = gh_();
  const cur = ghGet_(path);
  if (cur && cur.text === text) return 'same';
  const body = { message: message, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8) };
  if (cur) body.sha = cur.sha;
  for (let i = 0; i < 2; i++) {
    const r = UrlFetchApp.fetch(ghUrl_(g.repo, path), { method: 'put', headers: g.headers, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
    if (r.getResponseCode() < 300) return cur ? 'updated' : 'created';
    if (r.getResponseCode() === 409 && i === 0) { const c2 = ghGet_(path); if (c2) body.sha = c2.sha; continue; }
    throw new Error('GitHub 쓰기 실패 ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 160));
  }
}

function notifyOwnerSafe_(text) {
  try { if (P.getProperty('OWNER_REFRESH_TOKEN')) notifyOwner_(text, CONFIG.NEWSLETTER_URL, '사이트 열기'); } catch (e) {}
}

/** 설치 점검: 설정값·트리거·카카오 연결·GitHub 권한을 한 번에 확인 (Claude가 설치 끝에 실행) */
function checkAll() {
  const lines = [];
  const need = ['NEWSLETTER_ID', 'NEWSLETTER_NAME', 'SITE_URL', 'WEB_APP_URL', 'KAKAO_REST_API_KEY', 'GITHUB_REPO', 'GITHUB_TOKEN'];
  need.forEach(function (k) { lines.push((P.getProperty(k) ? 'OK   ' : '없음 ') + k); });
  const trig = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  lines.push((trig.indexOf('tick') >= 0 ? 'OK   ' : '없음 ') + 'tick 1분 트리거 (setup 실행)');
  lines.push((P.getProperty('OWNER_REFRESH_TOKEN') ? 'OK   ' : '없음 ') + '발신자 카카오 연결 (setup 로그의 발신자 연결 주소)');
  try { const f = ghGet_('index.html'); lines.push((f ? 'OK   ' : '없음 ') + 'GitHub 저장소 읽기 ' + P.getProperty('GITHUB_REPO')); }
  catch (e) { lines.push('실패 GitHub: ' + errText_(e)); }
  lines.push('     토큰 만료: ' + (P.getProperty('GITHUB_TOKEN_EXPIRES') || '확인 전'));
  try { const ind = ghGet_('indicators.json'); lines.push('OK   지표 ' + (ind ? JSON.parse(ind.text).indicators.length : 0) + '개 설정'); }
  catch (e) { lines.push('실패 indicators.json: ' + errText_(e)); }
  console.log(lines.join('\n'));
  return lines;
}
