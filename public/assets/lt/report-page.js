// 레벨테스트 리포트 인쇄 화면 (/lt-report#결과번호): A4 세 장을 늘어놓고 'PDF로 저장'으로 인쇄 창을 열어요.
// 선생님 계정으로만 열려요. 저장한 PDF를 학부모님께 카카오톡이나 문자로 보내요.
const $ = (id) => document.getElementById(id);
const say = (t) => {
  $('msg').textContent = t;
};

function fitScreen() {
  const paper = $('paper');
  const sheet = paper.querySelector('.rp-sheet');
  if (!sheet) return;
  paper.classList.remove('fit');
  paper.style.cssText = '';
  const w = sheet.offsetWidth;
  const room = document.documentElement.clientWidth - 16;
  if (room >= w) return;
  const k = room / w;
  paper.classList.add('fit');
  paper.style.width = `${w}px`;
  paper.style.marginLeft = '8px';
  paper.style.transform = `scale(${k})`;
  paper.style.marginBottom = `${-paper.offsetHeight * (1 - k)}px`;
}

async function imagesReady(root) {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((ok) => {
    img.addEventListener('load', ok, { once: true });
    img.addEventListener('error', ok, { once: true });
  }))));
}

async function main() {
  const id = Number(String(location.hash || '').replace(/[^0-9]/g, ''));
  if (!id) {
    say('어떤 결과의 리포트인지 알 수 없어요. 레벨테스트 결과 화면에서 다시 열어 주세요.');
    return;
  }
  let data;
  try {
    const res = await fetch(`/api/admin/lt/${id}`, { credentials: 'same-origin', headers: { 'X-Ivy': '1' } });
    data = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      say('선생님 계정으로 로그인한 뒤 다시 열어 주세요.');
      return;
    }
    if (!res.ok) {
      say((data && data.error) || '리포트를 불러오지 못했어요.');
      return;
    }
  } catch {
    say('인터넷 연결을 확인해 주세요.');
    return;
  }
  if (!data.done) {
    say('아직 시험을 다 보지 않았어요. 시험이 끝나면 리포트를 만들 수 있어요.');
    return;
  }
  const paper = $('paper');
  paper.innerHTML = data.html;
  document.title = data.file_name || '영어 레벨테스트 리포트';
  $('title').textContent = `${data.session.name} 학생 리포트`;
  await imagesReady(paper);
  try {
    await document.fonts.ready;
  } catch {
    /* 글꼴을 못 기다려도 괜찮아요 */
  }
  fitScreen();
  window.addEventListener('resize', fitScreen);
  const wait = data.scoring && data.scoring.need ? ' 라이팅은 아직 채점 전이에요. 채점이 끝난 뒤 저장하면 라이팅 결과도 들어가요.' : '';
  say(`인쇄 창에서 'PDF로 저장'을 고르면 A4 세 장짜리 PDF가 만들어져요. 용지는 A4, 여백은 '없음'으로 두세요.${wait}`);
  const btn = $('pdf');
  btn.disabled = false;
  btn.onclick = () => window.print();
  window.__ready = true;
}

main();
