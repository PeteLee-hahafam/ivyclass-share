// 레벨테스트 문제 은행과 채점, 계단식 진행, 분석, 리포트 (선생님께 보여 드린 예시 화면 v2 코드를 옮긴 것)
// - 정답이 들어 있어서 서버에서만 써요. 학생 화면에는 lt/flow.js 가 정답을 뺀 문항만 보내요.
// - 아래 '===== 파일 이름 =====' 은 예시 화면에서 나눠 두었던 파일 이름이에요. 고칠 때는 이 파일을 직접 고쳐요.
// - 화면에 나가는 글에는 가운뎃점(·)을 쓰지 않아요 (AGENTS.md).
/* eslint-disable */
// ===== bank.js =====
/* 리딩 레벨테스트 문제 은행 (예시 1세트)
   - 12단계 = 우리나라 초1 ~ 고3. 단계마다 지문 1개 + 3문항.
   - 지문과 문항은 모두 새로 쓴 것 (교과서·기출 원문 아님).
   - 표시: __밑줄__, {A} 빈칸 (A), {_} 긴 빈칸, ( ① ) 넣을 자리 */

const LT_SKILLS = {
  voc: { name: '어휘', long: '낱말 뜻을 알고 문맥에 맞게 이해하는 힘' },
  sen: { name: '문장 해석', long: '주어, 동사, 꾸밈말을 잡아 문장을 정확히 해석하는 힘' },
  det: { name: '세부 내용', long: '글에 나온 사실을 정확히 찾는 힘' },
  main: { name: '중심 내용', long: '글 전체의 주제, 목적, 제목을 잡는 힘' },
  inf: { name: '추론', long: '근거를 바탕으로 쓰여 있지 않은 것을 짐작하는 힘' },
  flow: { name: '글의 흐름', long: '연결어와 문장 위치로 논리의 흐름을 따라가는 힘' },
};
const LT_SKILL_ORDER = ['voc', 'sen', 'det', 'main', 'inf', 'flow'];

const LT_LEVELS = [
  null,
  { lv: 1, short: '초1', name: '초등학교 1학년', stage: '낱말 읽기', time: 90, desc: '알파벳 소리를 이어 짧은 낱말을 읽고, 짧은 문장을 그림과 맞춰요.' },
  { lv: 2, short: '초2', name: '초등학교 2학년', stage: '짧은 이야기', time: 120, desc: '자주 쓰는 낱말로 된 다섯 문장 안팎의 이야기를 읽어요.' },
  { lv: 3, short: '초3', name: '초등학교 3학년', stage: '초등 3학년 교과서', time: 120, desc: '현재형 문장으로 된 40단어 안팎의 글에서 내용을 찾아요.' },
  { lv: 4, short: '초4', name: '초등학교 4학년', stage: '초등 4학년 교과서', time: 150, desc: '편지처럼 목적이 있는 50단어 안팎의 글을 읽어요.' },
  { lv: 5, short: '초5', name: '초등학교 5학년', stage: '초등 5학년 교과서', time: 180, desc: '과거 이야기와 비교, 이유 표현이 든 70단어 안팎의 글을 읽어요.' },
  { lv: 6, short: '초6', name: '초등학교 6학년', stage: '초등 6학년 교과서', time: 180, desc: '미래 표현과 꾸밈말이 든 90단어 안팎의 안내문을 읽어요.' },
  { lv: 7, short: '중1', name: '중학교 1학년', stage: '중1 교과서 본문', time: 210, desc: '동명사, to부정사가 든 120단어 안팎의 설명문을 읽어요.' },
  { lv: 8, short: '중2', name: '중학교 2학년', stage: '중2 교과서 본문', time: 240, desc: '현재완료, 수동태, 관계대명사가 섞인 150단어 안팎의 이야기를 읽어요.' },
  { lv: 9, short: '중3', name: '중학교 3학년', stage: '중3 교과서 본문', time: 240, desc: '분사구문, 간접의문문이 든 140단어 안팎의 설명문을 읽어요.' },
  { lv: 10, short: '고1', name: '고등학교 1학년', stage: '고1 모의고사', time: 300, desc: '심리, 사회 소재의 글에서 빈칸과 긴 구문을 풀어요.' },
  { lv: 11, short: '고2', name: '고등학교 2학년', stage: '고2 모의고사', time: 330, desc: '추상적인 소재의 글에서 주제와 문장 위치를 찾아요.' },
  { lv: 12, short: '고3', name: '고등학교 3학년', stage: '수능', time: 360, desc: '논증이 깊은 글에서 빈칸 추론과 긴 문장 해석을 해요.' },
];

const LT_BANK = {
  1: {
    title: '그림과 낱말',
    passage: null,
    items: [
      { skill: 'voc', tag: '소리 이어 읽기(c-a-t)', q: '그림에 맞는 낱말을 고르세요.', pic: 'cat', opts: ['cat', 'cap', 'cut'], a: 0, why: 'c-a-t 소리를 이어 읽으면 cat(고양이)이에요.' },
      { skill: 'sen', tag: '수와 복수형(two apples)', q: '문장에 맞는 그림을 고르세요.', box: 'I have two apples.', opts: [{ pic: 'apple1' }, { pic: 'apple2' }, { pic: 'ball2' }], a: 1, why: 'two apples는 사과 두 개예요.' },
      { skill: 'det', tag: '색깔과 물건 함께 읽기', q: 'Tom의 공은 어느 것일까요?', box: 'Tom has a ball.\nThe ball is blue.', opts: [{ pic: 'ballRed' }, { pic: 'hatBlue' }, { pic: 'ballBlue' }], a: 2, why: 'The ball is blue. 파란 공이에요. 파란 모자는 공이 아니에요.' },
    ],
  },
  2: {
    title: 'My Dog Max',
    passage: 'I have a dog. His name is Max. Max is small and brown. He likes to run in the __park__. __He does not like baths!__',
    items: [
      { skill: 'det', tag: '꾸밈말 두 개(small and brown)', q: 'Max는 어떤 강아지인가요?', opts: ['크고 갈색이에요.', '작고 갈색이에요.', '작고 하얀색이에요.'], a: 1, why: 'Max is small and brown. 작고 갈색이에요.' },
      { skill: 'voc', tag: '장소 낱말(park)', q: '밑줄 친 park는 무슨 뜻일까요?', opts: ['학교', '바다', '공원'], a: 2, why: 'run in the park, 공원에서 달려요.' },
      { skill: 'sen', tag: '부정문(does not)', q: '밑줄 친 문장의 뜻은 무엇일까요?', opts: ['Max는 목욕을 좋아하지 않아요.', 'Max는 목욕을 아주 좋아해요.', 'Max는 공원을 좋아하지 않아요.'], a: 0, why: 'does not like는 좋아하지 않는다는 뜻이에요.' },
    ],
  },
  3: {
    title: 'Birds on the Way',
    passage: 'My name is Jina. I am nine years old. Every morning, I walk to school with my dad. We see many birds on the way. Dad likes the small yellow birds. I like the big black birds. They are very __loud__!',
    items: [
      { skill: 'det', tag: '누구와 어떻게(walk with my dad)', q: '글의 내용과 맞는 것은?', opts: ['지나는 버스를 타고 학교에 가요.', '지나는 아빠와 함께 걸어서 학교에 가요.', '지나는 작은 노란 새를 좋아해요.', '아빠는 크고 검은 새를 좋아해요.'], a: 1, why: 'I walk to school with my dad. 노란 새는 아빠가, 검은 새는 지나가 좋아해요.' },
      { skill: 'voc', tag: '꾸밈말(loud)', q: '밑줄 친 loud의 뜻으로 알맞은 것은?', opts: ['조용한', '귀여운', '시끄러운', '배고픈'], a: 2, why: '크고 검은 새들이 very loud, 아주 시끄러워요.' },
      { skill: 'main', tag: '글 전체 내용', q: '이 글은 무엇에 대한 이야기인가요?', opts: ['학교 가는 길에 보는 새들', '지나의 생일 파티', '아빠가 하는 일', '새에게 먹이 주는 방법'], a: 0, why: '학교 가는 길(on the way)에 보는 새 이야기예요.' },
    ],
  },
  4: {
    title: 'A Letter to Grandma',
    passage: 'Dear Grandma,\nHow are you? I\'m writing this letter in my room. __It\'s raining outside, so I can\'t play soccer today.__ Last Sunday, Mom and I made cookies for you. They look like little stars. We will visit you next Saturday with the cookies. I miss you a lot!\nLove,\nMinho',
    items: [
      { skill: 'main', tag: '편지를 쓴 목적', q: '민호가 이 편지를 쓴 까닭으로 가장 알맞은 것은?', opts: ['할머니께 안부를 여쭙고 찾아뵐 날을 알리려고', '할머니를 축구 경기에 초대하려고', '쿠키 만드는 방법을 여쭤보려고', '비 오는 날 할 일을 추천하려고'], a: 0, why: 'How are you?로 안부를 묻고, We will visit you next Saturday로 갈 날을 알려요.' },
      { skill: 'det', tag: '때(last Sunday)와 한 일', q: '편지의 내용과 맞는 것은?', opts: ['오늘은 날씨가 맑아요.', '쿠키는 하트 모양이에요.', '민호는 지난 일요일에 엄마와 쿠키를 만들었어요.', '민호는 이번 일요일에 할머니 댁에 가요.'], a: 2, why: 'Last Sunday, Mom and I made cookies. 쿠키는 별 모양이고, 가는 날은 토요일이에요.' },
      { skill: 'sen', tag: 'so와 can\'t가 든 문장 해석', q: '밑줄 친 문장의 뜻으로 알맞은 것은?', opts: ['밖에 비가 오지만 오늘 축구를 할 거예요.', '밖에 비가 와서 오늘은 축구를 할 수 없어요.', '비가 그치면 오늘 축구를 할 수 있어요.', '어제 비가 와서 축구를 하지 못했어요.'], a: 1, why: 'so는 "그래서", can\'t는 "할 수 없다"예요. 비가 와서 축구를 못 해요.' },
    ],
  },
  5: {
    title: 'Sounds in the Dark',
    passage: 'Last summer, my family went camping near a lake. On the first night, it was colder than we expected. So we sat by the fire in our jackets. Suddenly, my little brother looked __scared__ because he heard strange sounds in the dark. Dad smiled and turned on his flashlight. It was only a family of ducks on their way to the water! My brother laughed, and soon he fell asleep.',
    items: [
      { skill: 'main', tag: '이야기의 제목', q: '글의 제목으로 가장 알맞은 것은?', opts: ['호수에서 수영하는 방법', '캠핑장에서 들린 이상한 소리의 정체', '아빠의 새 손전등', '추운 날 옷을 입는 방법'], a: 1, why: '어둠 속 이상한 소리(strange sounds)가 오리 가족이었다는 이야기예요.' },
      { skill: 'voc', tag: '감정을 나타내는 말(scared)', q: '밑줄 친 scared의 뜻으로 가장 알맞은 것은?', opts: ['신이 난', '배고픈', '졸린', '무서워하는'], a: 3, why: '어둠 속에서 이상한 소리를 들어서(because) 무서워했어요.' },
      { skill: 'inf', tag: '마지막 행동의 이유', q: '동생이 마지막에 웃은 까닭으로 가장 알맞은 것은?', opts: ['이상한 소리가 오리 가족이 내는 소리였다는 걸 알게 되어서', '아빠가 재미있는 이야기를 들려주어서', '모닥불에 마시멜로를 구워 먹어서', '다음 날 집에 가게 되어서'], a: 0, why: '무서운 소리가 only a family of ducks였다는 걸 알고 웃었어요.' },
    ],
  },
  6: {
    title: 'Our Class Market',
    passage: 'Next Friday, our class is going to hold a small market. __Each student will bring one or two things that they don\'t use anymore__, like books, toys, or clothes. Instead of money, we will use paper tickets. Every student gets ten tickets at the start. You can use them to "buy" things from your friends. Our teacher says this is a good way to reduce waste and share with others. Anything left at the end of the day will go to a children\'s center in our town.',
    items: [
      { skill: 'det', tag: '세부 사실(돈 대신 표)', q: '글의 내용과 맞지 않는 것은?', opts: ['장터는 다음 주 금요일에 열린다.', '학생마다 물건을 한두 개씩 가져온다.', '물건을 살 때는 돈을 내야 한다.', '선생님은 이 행사가 쓰레기를 줄이는 좋은 방법이라고 한다.'], a: 2, why: 'Instead of money, we will use paper tickets. 돈 대신 표를 써요.' },
      { skill: 'sen', tag: '관계대명사 that이 꾸미는 말', q: '밑줄 친 부분의 뜻으로 가장 알맞은 것은?', opts: ['학생들은 각자 한두 개의 물건을 사서 더는 쓰지 않을 것이다.', '학생들은 각자 더는 쓰지 않는 물건을 한두 개씩 가져올 것이다.', '학생들은 각자 쓰지 않는 물건을 한두 개씩 버릴 것이다.', '학생들은 각자 책이나 장난감을 한두 개씩 빌려줄 것이다.'], a: 1, why: 'that they don\'t use anymore가 things를 꾸며요. "더는 쓰지 않는 물건".' },
      { skill: 'inf', tag: '안내 내용을 적용하기', q: '아무도 사지 않은 물건은 어떻게 될까요?', opts: ['주인이 다시 집으로 가져간다.', '선생님이 표를 주고 산다.', '다음 주 장터에서 다시 판다.', '우리 동네 아동 센터로 보내진다.'], a: 3, why: 'Anything left at the end of the day, 끝까지 남은 물건은 아동 센터로 가요.' },
    ],
  },
  7: {
    title: 'Why Cats Sleep So Much',
    passage: 'Have you ever wondered why cats sleep so much? An adult cat sleeps about 12 to 16 hours a day. This may seem lazy, but scientists say there is a good reason for this behavior. In the wild, cats hunt small animals, and hunting takes a lot of energy. Even a short __chase__ can make a cat very tired. By sleeping for many hours, cats save energy for the next hunt. Pet cats don\'t need to hunt for their food, {A} they still have this habit. That\'s why your cat often looks sleepy during the day and becomes more active in the evening, just like its relatives in the wild. So the next time you find your cat sleeping on the sofa, don\'t worry. It is just being a cat.',
    items: [
      { skill: 'main', tag: '설명문의 주제', q: '글의 주제로 가장 알맞은 것은?', opts: ['고양이를 훈련하는 방법', '야생 고양이와 집고양이의 먹이 차이', '고양이가 잠을 많이 자는 이유', '고양이가 소파를 좋아하는 이유'], a: 2, why: '첫 문장의 질문(why cats sleep so much)에 답하는 글이에요.' },
      { skill: 'voc', tag: '문맥으로 뜻 짐작(chase)', q: '밑줄 친 chase의 뜻으로 가장 알맞은 것은?', opts: ['뒤쫓기', '낮잠', '먹이', '울음소리'], a: 0, why: '사냥(hunt) 이야기 다음이라 "짧게 뒤쫓기만 해도 지친다"는 뜻이에요.' },
      { skill: 'flow', tag: '연결어 but', q: '빈칸 (A)에 들어갈 말로 가장 알맞은 것은?', opts: ['so', 'because', 'but', 'or'], a: 2, why: '사냥할 필요가 없는데도 여전히(still) 습관이 있다, 반대로 잇는 but이에요.' },
    ],
  },
  8: {
    title: 'A Missed Note',
    passage: 'Sora has played the violin since she was six. Last month, she was chosen to perform a solo at the school concert. At first, she was excited, but soon she began to worry. What if she made a terrible mistake in front of the whole school? __Her teacher, who had performed on many stages, gave her some advice.__ "Mistakes are a natural part of music," he said. "If you make one, don\'t stop. Just keep playing, and most people in the audience won\'t even notice." On the day of the concert, Sora\'s hands were shaking so badly that she could hardly hold her bow. In the middle of the song, she did miss a note. But she remembered her teacher\'s words and continued until the very end. When the performance was over, the audience applauded for a long time. Sora smiled. She had learned something more important than playing perfectly.',
    items: [
      { skill: 'inf', tag: '인물의 심경 변화', q: '연주회 날 Sora의 심경 변화로 가장 알맞은 것은?', opts: ['bored → excited', 'nervous → relieved', 'angry → sorry', 'proud → disappointed'], a: 1, why: '손이 떨리다가(hands were shaking) 박수를 받고 웃었어요(smiled).' },
      { skill: 'det', tag: '현재완료(has played since)', q: '글의 내용과 일치하는 것은?', opts: ['Sora는 학교 연주회에서 합주를 맡았다.', '선생님은 실수하면 처음부터 다시 연주하라고 했다.', 'Sora는 연주하는 동안 한 음도 틀리지 않았다.', 'Sora는 여섯 살 때부터 바이올린을 연주해 왔다.'], a: 3, why: 'has played the violin since she was six. 솔로를 맡았고, 한 음을 틀렸어요.' },
      { skill: 'sen', tag: '관계대명사 who와 과거완료가 든 문장 해석', q: '밑줄 친 문장의 뜻으로 가장 알맞은 것은?', opts: ['많은 무대에서 공연해 본 그녀의 선생님은 그녀에게 몇 가지 조언을 해 주었다.', '그녀의 선생님은 그녀에게 많은 무대에서 공연하라고 조언했다.', '그녀는 많은 무대에서 공연한 선생님에게 조언을 구했다.', '그녀의 선생님은 조언을 듣고 나서 많은 무대에서 공연했다.'], a: 0, why: '주어 Her teacher, 동사 gave. who had performed on many stages는 선생님을 덧붙여 설명해요.' },
    ],
  },
  9: {
    title: 'Why Do We Yawn?',
    passage: 'Have you ever yawned just because someone next to you did? You are not alone. Yawning is surprisingly __contagious__, and some people even yawn while reading about it. Interestingly, scientists still don\'t fully understand why we yawn. For a long time, people believed that we yawned to get more oxygen. {A}, studies have not supported this idea. Today, one popular theory suggests that yawning helps cool down the brain. Taking in a deep breath of air, we may lower the temperature of the brain, which helps it work better. This could explain why we tend to yawn when we are tired or bored, the moments when our brains need a little help to stay alert. So the next time you yawn in class, you can tell your teacher that your brain is just trying to work harder!',
    items: [
      { skill: 'main', tag: '설명문의 주제', q: '글의 주제로 가장 알맞은 것은?', opts: ['하품을 참는 방법', '하품을 하는 까닭에 대한 과학적 설명', '수업 시간에 졸지 않는 방법', '산소가 뇌에 미치는 영향'], a: 1, why: '하품을 하는 이유에 대한 옛 생각(산소)과 새 이론(뇌 식히기)을 설명해요.' },
      { skill: 'voc', tag: '문맥으로 뜻 짐작(contagious)', q: '밑줄 친 contagious의 뜻으로 가장 알맞은 것은?', opts: ['위험한', '지루한', '건강에 좋은', '옮는, 전염되는'], a: 3, why: '옆 사람이 하품하면 따라 하게 된다는 앞 문장이 근거예요.' },
      { skill: 'flow', tag: '연결어 However', q: '빈칸 (A)에 들어갈 말로 가장 알맞은 것은?', opts: ['However', 'For example', 'As a result', 'In addition'], a: 0, why: '오래 믿어 온 생각을 연구가 뒷받침하지 않았다, 앞뒤가 반대라 However예요.' },
    ],
  },
  10: {
    title: 'The Spotlight Effect',
    passage: 'Imagine walking into a classroom with a large stain on your shirt. You would probably feel as if everyone were staring at you. Psychologists call this feeling the "spotlight effect": the tendency to believe that other people notice our appearance and behavior much more than they actually do. In one well-known study, college students were asked to wear a T-shirt with an embarrassing picture on it and enter a room full of other students. Afterwards, they guessed that about half of the people in the room had noticed the shirt. In reality, far fewer had. The reason is simple: __most people are too busy thinking about themselves to pay close attention to others__. Understanding this can be freeing. The next time you worry about a small mistake you made in front of others, remember that they are probably {_}.',
    items: [
      { skill: 'inf', tag: '빈칸 추론', q: '빈칸에 들어갈 말로 가장 알맞은 것은?', opts: ['remembering it more clearly than you do', 'paying far less attention to it than you think', 'judging you more harshly than your friends do', 'expecting you to make the same mistake again', 'trying hard to hide their own mistakes'], a: 1, why: '사람들은 남에게 생각보다 훨씬 덜 주목한다는 글의 결론이에요.' },
      { skill: 'det', tag: '연구 내용 일치', q: '윗글의 내용과 일치하는 것은?', opts: ['연구에서 학생들은 평범한 티셔츠를 입고 방에 들어갔다.', '학생들은 방 안 사람들 대부분이 셔츠를 알아챘을 거라고 짐작했다.', '실제로 셔츠를 알아챈 사람은 학생들의 짐작보다 많았다.', '스포트라이트 효과는 남들이 나를 실제보다 더 많이 주목한다고 믿는 경향이다.', '이 효과를 알게 되면 실수에 더 신경 쓰게 된다.'], a: 3, why: '셔츠에는 창피한 그림이 있었고, 짐작은 절반(about half), 실제는 훨씬 적었어요(far fewer).' },
      { skill: 'sen', tag: 'too ~ to 구문', q: '밑줄 친 부분의 뜻으로 가장 알맞은 것은?', opts: ['대부분의 사람들은 다른 사람에게 주의를 기울이느라 자기 자신을 생각할 겨를이 없다.', '대부분의 사람들은 다른 사람에게 세심한 주의를 기울이려고 자기 생각을 멈춘다.', '대부분의 사람들은 자기 자신을 생각하느라 너무 바빠서 다른 사람에게 세심한 주의를 기울이지 못한다.', '대부분의 사람들은 바쁠 때 자기보다 다른 사람을 더 많이 생각한다.', '대부분의 사람들은 자기 자신을 생각하기보다 다른 사람을 지켜보느라 더 바쁘다.'], a: 2, why: 'too busy ~ing to ...는 "~하느라 너무 바빠서 ...하지 못한다"예요.' },
    ],
  },
  11: {
    title: 'Desire Lines',
    passage: 'Walk through almost any park and you will find narrow dirt trails cutting across the grass, often running right beside a perfectly good paved path. Planners call these "desire lines." They are created not by designers but by thousands of ordinary people, each choosing the route that feels most natural. ( ① ) For decades, such trails were treated as a problem to be fixed with fences and warning signs. ( ② ) More recently, however, some planners have begun to see desire lines differently, not as damage but as information. ( ③ ) Rather than deciding in advance where people should walk, they leave an area unpaved for a while, watch where paths naturally form, and only then lay down concrete. ( ④ ) The result is a design that people actually use, because it __reflects__ how they really behave rather than how someone assumed they would. ( ⑤ ) In this sense, a desire line is a quiet message from users, and good design begins with listening to it.',
    items: [
      { skill: 'main', tag: '추상적인 글의 주제', q: '윗글의 주제로 가장 알맞은 것은?', opts: ['the high cost of repairing damaged parks', 'why people should stay on paved paths', 'using people\'s natural paths as a guide for design', 'the history of fences in public parks', 'how designers create natural-looking trails'], a: 2, why: '사람들이 낸 길을 정보로 보고 설계에 쓰자는 글이에요.' },
      { skill: 'voc', tag: '뜻이 비슷한 말(reflects)', q: '밑줄 친 reflects와 의미가 가장 가까운 것은?', opts: ['prevents', 'changes', 'ignores', 'shows', 'repeats'], a: 3, why: '사람들이 실제로 어떻게 걷는지를 "보여 주는(반영하는)" 설계예요.' },
      { skill: 'flow', tag: '문장 넣기', q: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 알맞은 곳은?', box: 'Yet the fences rarely worked; people simply walked around them and made new trails.', opts: ['①', '②', '③', '④', '⑤'], a: 1, why: 'the fences가 가리킬 말(fences and warning signs) 바로 뒤, 새로운 시각(More recently) 앞이에요.' },
    ],
  },
  12: {
    title: 'The Use of Forgetting',
    passage: 'We tend to think of forgetting as a failure, a leak in the container of memory that we would fix if we could. Yet a growing body of research suggests that forgetting may be less a flaw than a feature. __A memory system that stored every detail with equal strength would quickly become cluttered, making it harder, not easier, to retrieve what matters.__ By letting go of details that are rarely used, the brain makes room for patterns that apply across many situations. Someone who remembered every dog they had ever met, down to the shape of each ear, might actually find it harder to recognize a new animal as a dog than someone who had kept only the general idea. In this view, the purpose of memory is not to preserve the past accurately but to {_}. Forgetting, then, is not the opposite of learning; it is part of how learning works.',
    items: [
      { skill: 'inf', tag: '빈칸 추론(글의 결론)', q: '빈칸에 들어갈 말로 가장 알맞은 것은?', opts: ['record our experiences as completely as possible', 'protect us from painful emotions linked to the past', 'help us share our personal stories with others', 'keep every detail available for later use', 'guide our decisions in a future that never exactly repeats the past'], a: 4, why: '기억의 목적은 과거 보존이 아니라(not A) 여러 상황에 쓸 패턴으로 앞날을 대비하는 것(but B)이에요.' },
      { skill: 'det', tag: '논증 내용 일치', q: '윗글의 내용과 일치하지 않는 것은?', opts: ['우리는 흔히 망각을 실패로 여긴다.', '모든 세부 사항을 똑같이 강하게 저장하면 중요한 것을 꺼내기 어려워진다.', '뇌는 드물게 쓰이는 세부 사항을 놓아 버려 일반적인 패턴을 남긴다.', '만난 개를 모두 세세히 기억하는 사람이 새로운 개를 더 쉽게 알아본다.', '망각은 학습이 이루어지는 방식의 일부이다.'], a: 3, why: '세세히 기억하는 사람이 오히려 더 어려워할 수 있다(might find it harder)고 했어요.' },
      { skill: 'sen', tag: '가정법, 분사구문이 든 긴 문장 해석', q: '밑줄 친 문장의 뜻으로 가장 알맞은 것은?', opts: ['모든 세부 사항을 똑같은 강도로 저장하려면 기억 체계가 어수선해지지 않게 중요한 것부터 꺼내야 한다.', '중요한 것을 꺼내기 어려운 기억 체계는 모든 세부 사항을 똑같은 강도로 저장하지 못한다.', '모든 세부 사항을 똑같은 강도로 저장하는 기억 체계는 금세 어수선해져서, 중요한 것을 꺼내기가 쉬워지기는커녕 더 어려워질 것이다.', '기억 체계가 어수선해지면 모든 세부 사항이 똑같은 강도로 저장되어 중요한 것을 더 쉽게 꺼낼 수 있다.', '모든 세부 사항을 똑같은 강도로 저장한 기억 체계는 중요한 것을 꺼내기 쉽게 금세 정리된다.'], a: 2, why: '주어 A memory system that stored ~, 동사 would become. making it harder ~ to retrieve는 그 결과예요.' },
    ],
  },
};

// ===== bank_vocab.js =====
/* 어휘 문항: 영어 낱말 빈도 순위로 9구간 (wordfreq 순위로 확인). 구간마다 4단어.
   size = 그 구간 낱말 수. 보기는 같은 구간 다른 낱말 뜻에서 골라요. */
const LT_VBANDS = [
  { b: 1, from: 1, to: 250, size: 250, time: 15, words: [['family', '가족'], ['night', '밤'], ['under', '~ 아래에'], ['best', '가장 좋은']], extra: ['학교', '삶'] },
  { b: 2, from: 251, to: 500, size: 250, time: 15, words: [['food', '음식'], ['child', '아이'], ['question', '질문'], ['late', '늦은']], extra: ['행복한', '틀린'] },
  { b: 3, from: 501, to: 1000, size: 500, time: 15, words: [['town', '마을'], ['visit', '방문하다'], ['pain', '통증, 고통'], ['truth', '진실']], extra: ['분명한', '심각한'] },
  { b: 4, from: 1001, to: 2000, size: 1000, time: 12, words: [['advice', '조언'], ['reduce', '줄이다'], ['knowledge', '지식'], ['receive', '받다']], extra: ['자연', '불가능한'] },
  { b: 5, from: 2001, to: 3000, size: 1000, time: 12, words: [['capable', '~할 능력이 있는'], ['respond', '응답하다'], ['affect', '영향을 미치다'], ['injured', '다친']], extra: ['합리적인', '날것의'] },
  { b: 6, from: 3001, to: 4000, size: 1000, time: 12, words: [['survival', '생존'], ['entrance', '입구'], ['contrast', '대조'], ['agricultural', '농업의']], extra: ['일과', '괜찮은'] },
  { b: 7, from: 4001, to: 5000, size: 1000, time: 12, words: [['courage', '용기'], ['overcome', '극복하다'], ['precious', '소중한'], ['steady', '꾸준한']], extra: ['잦은', '개념'] },
  { b: 8, from: 5001, to: 6500, size: 1500, time: 12, words: [['privilege', '특권'], ['preserve', '보존하다'], ['harmony', '조화'], ['justify', '정당화하다']], extra: ['쓰레기', '보상'] },
  { b: 9, from: 6501, to: 8000, size: 1500, time: 12, words: [['authentic', '진짜의'], ['transparent', '투명한'], ['profound', '깊은, 심오한'], ['deliberately', '일부러']], extra: ['철저한', '성취하다'] },
];
// 보기 만들기: 정답 + 같은 구간 다른 뜻 3개 (문항마다 고정된 순서)
(function () {
  LT_VBANDS.forEach((B) => {
    const pool = B.words.map((w) => w[1]).concat(B.extra);
    B.items = B.words.map(([en, ko], i) => {
      const others = pool.filter((m) => m !== ko);
      const pick = [others[(i + 1) % others.length], others[(i + 3) % others.length], others[(i + 4) % others.length]];
      const opts = [ko, ...pick];
      const rot = (i * 3 + B.b) % 4;
      const ordered = opts.slice(rot).concat(opts.slice(0, rot));
      return { en, ko, opts: ordered, a: ordered.indexOf(ko) };
    });
  });
})();

// ===== bank_grammar.js =====
/* 문법 문항: 12단계 × 3문항. 우리 교육과정 진도 순서.
   빈칸형은 ___, 어법형(고2·고3)은 {번호:낱말} 표시로 밑줄을 그어요. */
const LT_GBANK = {
  1: { topic: '관사, 명사', items: [
    { pt: 'a / an', q: 'This is ___ apple.', opts: ['a', 'an', 'two'], a: 1, why: 'apple은 모음 소리로 시작해서 an을 써요.' },
    { pt: '명사의 복수형', q: 'I have three ___.', opts: ['cat', 'cats', 'a cat'], a: 1, why: 'three(셋) 뒤에는 여럿을 나타내는 cats.' },
    { pt: 'this / these', q: '___ is a pencil.', opts: ['This', 'These', 'We'], a: 0, why: 'a pencil은 하나라서 This.' },
  ] },
  2: { topic: 'be동사', items: [
    { pt: 'be동사 am, is, are', q: 'I ___ a student.', opts: ['am', 'is', 'are'], a: 0, why: 'I 다음에는 am.' },
    { pt: 'be동사 am, is, are', q: 'They ___ my friends.', opts: ['is', 'am', 'are'], a: 2, why: 'They(그들) 다음에는 are.' },
    { pt: 'be동사 의문문', q: '___ she your sister?', opts: ['Is', 'Are', 'Am'], a: 0, why: 'she를 묻는 의문문은 Is로 시작해요.' },
  ] },
  3: { topic: '일반동사 현재', items: [
    { pt: '3인칭 단수 현재(-s)', q: 'He ___ soccer every day.', opts: ['play', 'plays', 'playing', 'is play'], a: 1, why: 'He(3인칭 단수) + 현재 → plays.' },
    { pt: '일반동사 부정문', q: 'I ___ like carrots.', opts: ['am not', "don't", "doesn't", 'not'], a: 1, why: "I + 일반동사 부정 → don't." },
    { pt: '일반동사 의문문', q: '___ your brother have a bike?', opts: ['Do', 'Does', 'Is', 'Are'], a: 1, why: 'your brother(3인칭 단수) → Does ~ have?' },
  ] },
  4: { topic: '진행형, 조동사, 명령문', items: [
    { pt: '현재진행형', q: 'Look! The baby ___ now.', opts: ['sleep', 'sleeps', 'is sleeping', 'sleeping'], a: 2, why: 'Look!, now → 지금 하고 있는 일: is sleeping.' },
    { pt: '조동사 + 동사원형', q: 'She can ___ the piano.', opts: ['play', 'plays', 'playing', 'to play'], a: 0, why: 'can 뒤에는 동사원형.' },
    { pt: 'be동사 명령문', q: '___ quiet in the library.', opts: ['Be', 'Are', 'Is', 'Being'], a: 0, why: '명령문은 동사원형으로 시작해요: Be quiet.' },
  ] },
  5: { topic: '과거, 비교급', items: [
    { pt: '불규칙 과거형', q: 'We ___ to the zoo last Sunday.', opts: ['go', 'goes', 'went', 'going'], a: 2, why: 'last Sunday → 과거. go의 과거는 went.' },
    { pt: '비교급', q: 'My bag is ___ than yours.', opts: ['heavy', 'heavier', 'heaviest', 'more heavy'], a: 1, why: 'than이 있으면 비교급: heavy → heavier.' },
    { pt: '과거 의문문', q: '___ you finish your homework yesterday?', opts: ['Do', 'Does', 'Did', 'Were'], a: 2, why: 'yesterday → 과거 의문문은 Did + 주어 + 동사원형.' },
  ] },
  6: { topic: '미래, 최상급, 접속사', items: [
    { pt: '미래 (be going to)', q: 'I ___ visit my grandma tomorrow.', opts: ['am going to', 'went', 'visiting', 'was'], a: 0, why: 'tomorrow → 미래: am going to visit.' },
    { pt: '최상급', q: 'This is the ___ building in our city.', opts: ['tall', 'taller', 'tallest', 'most tall'], a: 2, why: '우리 도시에서 가장 → the tallest.' },
    { pt: '접속사 because', q: 'I stayed home ___ it was raining.', opts: ['because', 'but', 'so', 'or'], a: 0, why: '비가 와서(이유) 집에 있었다 → because.' },
  ] },
  7: { topic: 'to부정사, 동명사, 감각동사', items: [
    { pt: 'to부정사 (want to)', q: 'I want ___ a doctor someday.', opts: ['be', 'being', 'to be', 'to being'], a: 2, why: 'want는 to부정사를 목적어로 써요: want to be.' },
    { pt: '동명사 (enjoy -ing)', q: 'He enjoys ___ comic books.', opts: ['read', 'reads', 'to read', 'reading'], a: 3, why: 'enjoy는 동명사를 목적어로 써요: enjoys reading.' },
    { pt: '감각동사 + 형용사', q: 'The soup smells ___.', opts: ['good', 'well', 'goodly', 'to good'], a: 0, why: 'smell(~한 냄새가 나다) 뒤에는 형용사 good.' },
  ] },
  8: { topic: '현재완료, 수동태, 관계대명사', items: [
    { pt: '현재완료 (계속)', q: 'I ___ in this town since 2020.', opts: ['live', 'lived', 'have lived', 'am living'], a: 2, why: 'since 2020(그때부터 지금까지) → have lived.' },
    { pt: '수동태 (과거)', q: 'This bridge ___ in 1990.', opts: ['built', 'was built', 'is building', 'has built'], a: 1, why: '다리는 지어진 것 → 수동태, 1990년 → was built.' },
    { pt: '주격 관계대명사 who', q: 'I have a friend ___ lives in Canada.', opts: ['which', 'who', 'what', 'whose'], a: 1, why: '사람(a friend) + 주어 역할 → who.' },
  ] },
  9: { topic: '관계대명사 what, 가정법, 간접의문문', items: [
    { pt: '관계대명사 what', q: '___ I need now is a long rest.', opts: ['That', 'Which', 'What', 'It'], a: 2, why: "'내가 지금 필요한 것' → What(~하는 것)." },
    { pt: '가정법 과거', q: 'If I ___ a bird, I would fly to you.', opts: ['am', 'were', 'have been', 'will be'], a: 1, why: '지금 사실과 반대 → If I were ~, I would ~.' },
    { pt: '간접의문문 어순', q: 'Do you know where ___?', opts: ['does he live', 'he lives', 'lives he', 'he does live'], a: 1, why: '문장 안의 의문문은 의문사 + 주어 + 동사: where he lives.' },
  ] },
  10: { topic: '분사구문, 관계부사, 가정법 과거완료', items: [
    { pt: '분사구문', q: '___ along the river, I met an old friend.', opts: ['Walk', 'Walked', 'Walking', 'To walking'], a: 2, why: '강을 따라 걷다가, 주어 I가 걷는 것(능동) → Walking.' },
    { pt: '관계부사 where', q: 'This is the town ___ I was born.', opts: ['which', 'where', 'what', 'how'], a: 1, why: '장소(the town) + 빠진 것 없는 문장(I was born) → where.' },
    { pt: '가정법 과거완료', q: 'If she had left earlier, she ___ the train.', opts: ['catches', 'would catch', 'would have caught', 'had caught'], a: 2, why: 'If + had p.p. → would have p.p. (지난 일과 반대).' },
  ] },
  11: { topic: '수능형 어법 1', kind: 'error', items: [
    { pt: '동명사 주어의 수일치', q: 'The number of students {1:who} walk to school {2:has} {3:increased}, and many of them say walking {4:help} them {5:stay} focused.', a: 3, why: '주어 walking(동명사)은 단수라서 helps.' },
    { pt: 'help + 목적어 + 동사원형', q: 'Not only {1:did} she finish the report, but she also {2:helped} her coworkers, {3:whose} work was {4:falling} behind, {5:finishing} theirs.', a: 4, why: 'help + 목적어(her coworkers) 뒤에는 (to) 동사원형: finish.' },
    { pt: '주어-동사 수일치 (삽입절)', q: 'The book, {1:which} {2:was written} in 1950, {3:remain} popular because it deals with problems {4:that} people still {5:face} today.', a: 2, why: '주어 The book은 단수라서 remains. 사이에 낀 관계절에 속지 않아야 해요.' },
  ] },
  12: { topic: '수능형 어법 2', kind: 'error', items: [
    { pt: '관계대명사절의 동사', q: 'It was not until the late 19th century {1:that} scientists began to understand how diseases {2:spread}, {3:which} {4:leading} to great changes in how hospitals {5:were} run.', a: 3, why: 'which가 이끄는 절에 동사가 없어요: which led to.' },
    { pt: '도치 문장의 동사', q: 'Rarely {1:does} a single study {2:settles} a scientific question; instead, findings {3:that} {4:are repeated} across many labs {5:are} what builds confidence.', a: 1, why: 'Rarely does + 주어 + 동사원형: does ~ settle.' },
    { pt: '2형식 보어 (become + 형용사)', q: 'Those who {1:have practiced} a skill for years often find {2:it} difficult {3:to explain} {4:how} they do it, because much of their knowledge has become {5:automatically}.', a: 4, why: 'become 뒤 보어 자리에는 형용사 automatic.' },
  ] },
};
// 어법형 보기 (①~⑤)
Object.values(LT_GBANK).forEach((L) => { if (L.kind === 'error') L.items.forEach((it) => { it.opts = ['①', '②', '③', '④', '⑤']; }); });

// ===== bank_listen.js =====
/* 듣기 문항: 12단계.
   - 초1~초3: 문항마다 짧은 소리 (두 번 들려줘요)
   - 초4~고3: 대화나 담화 하나를 듣고 3문항 (초4~초6은 두 번, 중1부터는 한 번)
   말하는 사람: M 남자, W 여자, N 안내 목소리 */
const LT_LBANK = {
  1: { kind: 'single', items: [
    { pt: '낱말 듣기', say: [['N', 'Cat.']], q: '들은 낱말에 맞는 그림을 고르세요.', opts: [{ pic: 'cat' }, { pic: 'apple1' }, { pic: 'hatBlue' }], a: 0, why: 'cat은 고양이예요.' },
    { pt: '색깔과 물건', say: [['N', 'A red ball.']], q: '들은 말에 맞는 그림을 고르세요.', opts: [{ pic: 'ballBlue' }, { pic: 'ballRed' }, { pic: 'hatBlue' }], a: 1, why: 'a red ball, 빨간 공이에요.' },
    { pt: '수와 복수형', say: [['N', 'Two apples.']], q: '들은 말에 맞는 그림을 고르세요.', opts: [{ pic: 'apple1' }, { pic: 'ball2' }, { pic: 'apple2' }], a: 2, why: 'two apples, 사과 두 개예요.' },
  ] },
  2: { kind: 'single', items: [
    { pt: '문장 듣기', say: [['N', 'I like dogs.']], q: '들은 문장의 뜻을 고르세요.', opts: ['나는 고양이를 좋아해요.', '나는 개를 좋아해요.', '나는 새를 좋아해요.'], a: 1, why: 'dogs는 개예요.' },
    { pt: '날씨', say: [['N', 'It is sunny today.']], q: '오늘 날씨는 어떤가요?', opts: ['비가 와요.', '눈이 와요.', '맑아요.'], a: 2, why: 'sunny는 맑다는 뜻이에요.' },
    { pt: '부탁하는 말', say: [['N', 'Open the door, please.']], q: '무엇을 해 달라는 말인가요?', opts: ['문을 열어 주세요.', '문을 닫아 주세요.', '창문을 열어 주세요.'], a: 0, why: 'open the door, 문을 열어 달라는 말이에요.' },
  ] },
  3: { kind: 'single', items: [
    { pt: '묻고 답하기', say: [['M', 'What color is your bag?'], ['W', "It's yellow."]], q: '여자의 가방은 무슨 색인가요?', opts: ['노란색', '파란색', '빨간색', '검은색'], a: 0, why: "It's yellow, 노란색이에요." },
    { pt: '나이', say: [['W', 'How old are you?'], ['M', "I'm ten years old."]], q: '남자는 몇 살인가요?', opts: ['여덟 살', '아홉 살', '열 살', '열한 살'], a: 2, why: 'ten years old, 열 살이에요.' },
    { pt: '위치', say: [['M', 'Where is my cap?'], ['W', "It's under the desk."]], q: '모자는 어디에 있나요?', opts: ['책상 위', '책상 아래', '의자 위', '침대 아래'], a: 1, why: 'under the desk, 책상 아래예요.' },
  ] },
  4: { kind: 'set', plays: 2, audio: [
    ['W', 'Hi, Jun. What are you doing this Saturday?'],
    ['M', "I'm going to the library with my dad."],
    ['W', 'Can I come with you? I need some books about animals.'],
    ['M', "Sure! Let's meet at ten in front of the library."],
    ['W', 'Great. See you then!'],
  ], items: [
    { pt: '세부 정보', q: '남자는 토요일에 누구와 도서관에 가나요?', opts: ['아빠', '엄마', '친구', '선생님'], a: 0, why: 'with my dad, 아빠와 가요.' },
    { pt: '세부 정보', q: '두 사람은 몇 시에 만나나요?', opts: ['9시', '10시', '11시', '12시'], a: 1, why: 'meet at ten, 10시예요.' },
    { pt: '이유', q: '여자가 도서관에 가려는 이유는?', opts: ['동물에 관한 책이 필요해서', '숙제를 하려고', '친구를 만나려고', '책을 돌려주려고'], a: 0, why: 'I need some books about animals.' },
  ] },
  5: { kind: 'set', plays: 2, audio: [
    ['M', "Mom, I'm home. I'm so hungry."],
    ['W', 'Did you have lunch at school?'],
    ['M', 'Yes, but I played basketball after school for two hours.'],
    ['W', "No wonder. There's some pizza in the fridge. Wash your hands first."],
    ['M', 'Okay. Thanks, Mom!'],
  ], items: [
    { pt: '세부 정보', q: '남자는 방과 후에 무엇을 했나요?', opts: ['축구', '농구', '수영', '피아노'], a: 1, why: 'played basketball, 농구를 했어요.' },
    { pt: '세부 정보', q: '남자는 얼마 동안 운동했나요?', opts: ['30분', '1시간', '2시간', '3시간'], a: 2, why: 'for two hours, 두 시간이에요.' },
    { pt: '다음 행동', q: '남자가 바로 다음에 할 일은?', opts: ['피자 데우기', '손 씻기', '숙제하기', '냉장고 청소하기'], a: 1, why: 'Wash your hands first. 손부터 씻어요.' },
  ] },
  6: { kind: 'set', plays: 2, audio: [
    ['W', 'Good morning, students. This is your principal speaking. Our school sports day will be held next Friday on the main field. Please wear your class T-shirt and bring a water bottle. If it rains, the event will move to the following Monday. Have a great week!'],
  ], items: [
    { pt: '주제, 목적', q: '방송의 목적은?', opts: ['운동회 안내', '급식 메뉴 안내', '시험 일정 안내', '체육복 판매 안내'], a: 0, why: 'sports day 안내 방송이에요.' },
    { pt: '세부 정보', q: '학생들이 준비할 것은?', opts: ['반 티셔츠와 물병', '운동화와 모자', '도시락과 우산', '공책과 연필'], a: 0, why: 'class T-shirt와 water bottle.' },
    { pt: '세부 정보', q: '비가 오면 어떻게 되나요?', opts: ['취소된다', '강당에서 한다', '다음 주 월요일로 미뤄진다', '오후로 미뤄진다'], a: 2, why: 'the following Monday로 옮겨요.' },
  ] },
  7: { kind: 'set', plays: 1, audio: [
    ['W', 'Minho, you look tired. Are you okay?'],
    ['M', 'I stayed up late last night to finish my science project.'],
    ['W', 'Oh, is it due today?'],
    ['M', "Yes, but I couldn't finish the last part. I'm going to ask my teacher for one more day."],
    ['W', "That's a good idea. And try to get some sleep tonight."],
    ['M', 'I will. Thanks.'],
  ], items: [
    { pt: '이유', q: '남자가 피곤한 이유는?', opts: ['과학 숙제 때문에 늦게 자서', '운동을 많이 해서', '아침을 굶어서', '감기에 걸려서'], a: 0, why: 'stayed up late to finish my science project.' },
    { pt: '세부 정보', q: '남자가 선생님께 부탁하려는 것은?', opts: ['숙제 기한을 하루 늘려 달라', '숙제를 도와 달라', '일찍 집에 가게 해 달라', '발표 순서를 바꿔 달라'], a: 0, why: 'ask my teacher for one more day.' },
    { pt: '세부 정보', q: '여자가 남자에게 한 조언은?', opts: ['과학실에 가 보라', '오늘 밤에는 잠을 자라', '친구에게 물어보라', '숙제를 처음부터 다시 하라'], a: 1, why: 'try to get some sleep tonight.' },
  ] },
  8: { kind: 'set', plays: 1, audio: [
    ['M', 'Excuse me, how much are these sneakers?'],
    ['W', "They're sixty dollars. But if you buy two pairs, you get twenty percent off the total."],
    ['M', 'Hmm, I only need one pair. Do you have them in size two hundred fifty?'],
    ['W', 'Let me check. Yes, we do. Would you like to try them on?'],
    ['M', 'Yes, please.'],
  ], items: [
    { pt: '숫자 정보', q: '남자가 운동화 한 켤레만 산다면 낼 돈은?', opts: ['48달러', '50달러', '60달러', '96달러'], a: 2, why: '두 켤레일 때만 할인이라 한 켤레는 60달러예요.' },
    { pt: '숫자 정보', q: '남자가 찾는 운동화 크기는?', opts: ['240', '245', '250', '255'], a: 2, why: 'size two hundred fifty.' },
    { pt: '다음 행동', q: '남자가 다음에 할 일은?', opts: ['다른 가게에 간다', '운동화를 신어 본다', '두 켤레를 산다', '돈을 돌려받는다'], a: 1, why: 'Would you like to try them on? Yes, please.' },
  ] },
  9: { kind: 'set', plays: 1, audio: [
    ['M', "Hello, everyone. Today I'd like to talk about a simple habit that changed my life: writing down three good things every night. When I started, I thought it was a little silly. But after a few weeks, I noticed that I was paying more attention to small, happy moments during the day, because I knew I would write them down later. I also started sleeping better. If you often feel stressed, why don't you try it for just one week?"],
  ], items: [
    { pt: '주제, 목적', q: '말하는 사람이 하려는 말은?', opts: ['매일 밤 좋은 일 세 가지를 쓰는 습관을 권한다', '일기를 잘 쓰는 방법을 알려 준다', '스트레스의 원인을 설명한다', '잠을 잘 자는 방법을 소개한다'], a: 0, why: 'try it for just one week, 습관을 권해요.' },
    { pt: '세부 정보', q: '처음에 이 습관을 어떻게 생각했나요?', opts: ['아주 어렵다고', '조금 우습다고', '시간 낭비라고', '아주 재미있다고'], a: 1, why: 'I thought it was a little silly.' },
    { pt: '세부 정보', q: '이 습관을 한 뒤 생긴 변화는?', opts: ['친구가 많아졌다', '일찍 일어나게 되었다', '잠을 더 잘 자게 되었다', '운동을 시작했다'], a: 2, why: 'I also started sleeping better.' },
  ] },
  10: { kind: 'set', plays: 1, audio: [
    ['W', "Daniel, I heard you're joining the school's recycling club."],
    ['M', 'Yes. I realized how much plastic our class throws away every day.'],
    ['W', "That's great. What does the club do?"],
    ['M', "We collect plastic bottles from each classroom and sort them. We're also planning a campaign to encourage students to bring their own cups."],
    ['W', "Sounds meaningful. But won't that take a lot of your time?"],
    ['M', "Only about an hour a week. I think it's worth it."],
  ], items: [
    { pt: '주제, 목적', q: '대화의 주제는?', opts: ['남자가 재활용 동아리에 들어간 이유와 활동', '플라스틱 컵의 장단점', '교실 청소 당번 정하기', '동아리 활동 시간 바꾸기', '학교 매점 이용 규칙'], a: 0, why: '동아리에 들어간 이유와 하는 일을 이야기해요.' },
    { pt: '세부 정보', q: '동아리 활동으로 언급된 것은?', opts: ['교실 화분 가꾸기', '중고 책 팔기', '개인 컵 가져오기 캠페인', '급식 남기지 않기', '분리수거함 만들기'], a: 2, why: 'a campaign to encourage students to bring their own cups.' },
    { pt: '숫자 정보', q: '남자가 동아리 활동에 쓰는 시간은?', opts: ['일주일에 30분', '일주일에 1시간', '하루에 1시간', '한 달에 1시간', '하루에 30분'], a: 1, why: 'about an hour a week.' },
  ] },
  11: { kind: 'set', plays: 1, audio: [
    ['M', 'Good afternoon, listeners. As you know, our city library will close for renovation starting next month. During the closure, which will last about three months, you can still borrow books through our online request system. Simply choose your books on the library website, and pick them up at the community center on Main Street. Returns can also be made there. We apologize for the inconvenience and look forward to welcoming you to a brighter, more comfortable library.'],
  ], items: [
    { pt: '주제, 목적', q: '방송의 목적은?', opts: ['새 도서관 개관식에 초대하려고', '공사 기간에 책 빌리는 방법을 알리려고', '연체료가 바뀐 것을 알리려고', '주민센터 이전을 알리려고', '도서관 봉사자를 모집하려고'], a: 1, why: 'online request system으로 빌리는 방법을 안내해요.' },
    { pt: '숫자 정보', q: '공사 기간은?', opts: ['약 1개월', '약 2개월', '약 3개월', '약 6개월', '약 1년'], a: 2, why: 'about three months.' },
    { pt: '세부 정보', q: '공사 기간에 책을 받는 곳은?', opts: ['도서관 정문', '메인 스트리트의 주민센터', '시청', '학교 도서실', '우체국'], a: 1, why: 'the community center on Main Street.' },
  ] },
  12: { kind: 'set', plays: 1, audio: [
    ['W', "Hello, students. In today's lecture, we'll look at why some animals live in groups. Living together has clear benefits. For example, many eyes make it easier to spot predators, and members can share information about where food is. However, group life also has costs. Animals in large groups must compete for the same food, and diseases can spread quickly when individuals live close together. So, whether an animal lives alone or in a group depends on which side of this balance is heavier in its environment. Now, let's look at some specific examples."],
  ], items: [
    { pt: '주제, 목적', q: '강의의 주제는?', opts: ['포식자를 피하는 방법', '동물이 무리 지어 사는 데 따르는 이점과 비용', '동물 사이의 질병 전파 경로', '먹이를 찾는 동물의 지능', '환경 변화가 동물에게 주는 영향'], a: 1, why: 'benefits와 costs를 함께 설명해요.' },
    { pt: '세부 정보', q: '무리 생활의 비용으로 언급된 것은?', opts: ['포식자가 늘어난다', '이동 거리가 길어진다', '먹이 경쟁과 질병 전파', '번식 기회가 줄어든다', '체온을 유지하기 어렵다'], a: 2, why: 'compete for the same food, diseases can spread.' },
    { pt: '추론', q: '강의 다음에 이어질 내용은?', opts: ['구체적인 동물 예시', '과제 안내', '시험 범위 안내', '질병 예방 방법', '지난 수업 복습'], a: 0, why: "Now, let's look at some specific examples." },
  ] },
};

// ===== bank_write.js =====
/* 라이팅 과제: 문법(없으면 리딩) 결과로 단계를 골라요.
   A 초1~초4: 글자·문장 맞추기 (자동 채점)
   B 초5~중2: 문장 맞추기 + 조건 영작 + 짧은 글 (AI 채점 초안 → 선생님 확인)
   C 중3~고3: 조건 영작 + 의견 글 (AI 채점 초안 → 선생님 확인) */
const LT_WBANK = {
  A: { name: '문장 쓰기 기초', from: 1, to: 4, items: [
    { id: 'wa1', kind: 'spell', q: '그림에 맞게 글자를 눌러 낱말을 만드세요.', pic: 'cat', tiles: ['t', 'c', 'p', 'a'], answer: ['cat'], time: 30, lv: 1 },
    { id: 'wa2', kind: 'order', q: '우리말에 맞게 낱말을 차례로 눌러 문장을 만드세요.', ko: '이것은 내 가방이야.', tiles: ['is', 'bag.', 'This', 'my'], answer: ['This is my bag.'], time: 45, lv: 3 },
    { id: 'wa3', kind: 'order', q: '우리말에 맞게 낱말을 차례로 눌러 문장을 만드세요.', ko: '그들은 공원에서 축구를 하고 있어.', tiles: ['soccer', 'They', 'in the park.', 'are', 'playing'], answer: ['They are playing soccer in the park.'], time: 45, lv: 4 },
  ] },
  B: { name: '문장에서 문단으로', from: 5, to: 8, items: [
    { id: 'wb1', kind: 'order', q: '우리말에 맞게 낱말을 차례로 눌러 문장을 만드세요.', ko: '나는 어제 친구와 영화를 봤어.', tiles: ['a movie', 'yesterday.', 'I', 'with my friend', 'watched'], answer: ['I watched a movie with my friend yesterday.'], time: 60 },
    { id: 'wb2', kind: 'cond', q: '조건에 맞게 영어 문장으로 쓰세요.', ko: '나는 주말마다 책 읽는 것을 좋아해.', cond: ['like 뒤에 -ing 쓰기', 'every weekend 넣기'], need: ['like', 'every weekend'], model: 'I like reading books every weekend.', time: 120,
      good: 'I like reading books every weekend.', flawed: 'I like reading book every weekend.' },
    { id: 'wb3', kind: 'cond', q: '조건에 맞게 영어 문장으로 쓰세요.', ko: '그 노래는 많은 사람들에게 사랑받아 왔어.', cond: ['현재완료 수동태(has been + p.p.) 쓰기'], need: ['has'], model: 'The song has been loved by many people.', time: 120,
      good: 'The song has been loved by many people.', flawed: 'The song has loved by many people.' },
    { id: 'wb4', kind: 'essay', q: '가장 좋아하는 장소를 3~5문장으로 소개하세요. 어디인지, 왜 좋은지 꼭 쓰세요.', words: [40, 70], time: 360,
      good: 'My favorite place is the small park behind my apartment. It has tall trees and a quiet bench by the pond. I usually go there after school to read or listen to music. I love this place because it helps me relax after a busy day. Whenever I feel stressed, I walk there and feel better.',
      flawed: 'My favorite place is the library near my house. It is quiet and there is many books. I go there every Saturday with my friend. We read comic books and study English together. I like it because I can relax there. Also the library have a small cafe, so we can eat snacks.' },
  ] },
  C: { name: '조건 영작과 의견 글', from: 9, to: 12, items: [
    { id: 'wc1', kind: 'cond', q: '조건에 맞게 영어 문장으로 쓰세요.', ko: '내가 너라면, 그 제안을 받아들일 거야.', cond: ['가정법 과거 쓰기', 'accept 쓰기'], need: ['if', 'accept'], model: 'If I were you, I would accept the offer.', time: 120,
      good: 'If I were you, I would accept the offer.', flawed: 'If I am you, I will accept the offer.' },
    { id: 'wc2', kind: 'cond', q: '조건에 맞게 영어 문장으로 쓰세요.', ko: '그가 그 문제를 해결한 방식은 모두를 놀라게 했다.', cond: ['The way로 시작하기'], need: ['the way'], model: 'The way he solved the problem surprised everyone.', time: 120,
      good: 'The way he solved the problem surprised everyone.', flawed: 'The way he solved the problem were surprising everyone.' },
    { id: 'wc3', kind: 'essay', q: '학교에서 휴대전화 사용을 허용해야 할까요? 한쪽 입장을 정하고 이유 두 가지를 들어 쓰세요.', words: [80, 120], time: 600,
      good: 'I believe students should not be allowed to use smartphones at school. First, phones are a major distraction. Even a single notification can break our concentration, and it often takes several minutes to focus again. Second, banning phones encourages real conversation. During breaks, students who are not looking at screens talk, play, and solve problems together, which builds stronger friendships. Some people argue that phones are useful for emergencies, but schools already have phones for that purpose. Therefore, keeping smartphones away during school hours helps students learn better and connect with each other.',
      flawed: 'I think students should use smartphone at school. First, smartphone is useful for study. We can search the word quickly. Second, it is good for safe because parents can call us. Some people say phone is bad but I dont think so. So school should allow smartphone.' },
  ] },
};
const LT_RUBRIC = [
  { key: 'task', name: '과제 수행', d5: '요구한 내용을 모두 담고 충분히 설명해요', d3: '요구한 내용이 일부 빠지거나 설명이 짧아요', d1: '과제와 거의 맞지 않거나 너무 짧아요' },
  { key: 'organization', name: '구성', d5: '처음, 가운데, 끝이 분명하고 연결어가 알맞아요', d3: '순서는 있지만 연결이 어색해요', d1: '문장이 나열만 되어 있어요' },
  { key: 'grammar', name: '문법', d5: '오류가 거의 없어요', d3: '오류가 있지만 뜻은 통해요', d1: '오류가 많아 뜻이 잘 안 통해요' },
  { key: 'vocabulary', name: '어휘', d5: '단계에 맞는 낱말을 다양하고 정확하게 써요', d3: '쉬운 낱말을 되풀이해요', d1: '낱말이 부족해 뜻을 전하기 어려워요' },
];
// 예시 학생 답의 채점 예시 (AI 채점 초안 모양)
const LT_WSAMPLE_SCORE = {
  items: [
    { id: 'wb2', points: 1, corrected: 'I like reading books every weekend.', note: '책을 여러 권 읽는 것이라 books로 써요.' },
    { id: 'wb3', points: 0, corrected: 'The song has been loved by many people.', note: '사랑받아 온 것이라 has been loved예요. been이 빠지면 노래가 사랑해 왔다는 뜻이 돼요.' },
  ],
  essay: { task: 4, organization: 3, grammar: 3, vocabulary: 3,
    errors: [
      { wrong: 'there is many books', right: 'there are many books', why: 'books가 여럿이라 are' },
      { wrong: 'the library have', right: 'the library has', why: '주어 the library는 하나라서 has' },
      { wrong: 'Also the library', right: 'Also, the library', why: '문장 앞 연결어 뒤에는 쉼표' },
    ],
    summary: '좋아하는 장소와 이유를 잘 썼어요. is/are, have/has 같은 수일치를 고치고 First, Also 같은 연결어로 문장을 이어 쓰면 한 단계 올라가요.' },
};

// ===== readability.js =====
/* 글 수준 자동 계산 (Flesch–Kincaid 학년). 공개 공식이라 누구나 써요. */
function ltSyllables(word) {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}
function ltPlain(text) {
  return String(text || '').replace(/__/g, '').replace(/\{A\}/g, 'but').replace(/\{_\}/g, 'something').replace(/\(\s*[①②③④⑤]\s*\)/g, ' ');
}
function ltFK(text) {
  const t = ltPlain(text);
  const words = t.split(/\s+/).filter((x) => /[A-Za-z]/.test(x));
  if (words.length < 5) return null;
  const sentences = Math.max(1, (t.match(/[.!?]+(?=\s|$|["')\]])/g) || []).length);
  const syl = words.reduce((a, w) => a + ltSyllables(w), 0);
  const g = 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
  return Math.round(g * 10) / 10;
}

// ===== logic.js =====
/* 레벨테스트 진행·채점·분석
   - 계단식: 지문 하나(3문항)에서 2개 이상 맞히면 통과 → 한 단계 위, 못 하면 한 단계 아래.
   - 3문항을 모두 맞히고 권장 시간의 60% 안에 끝내면 두 단계 위로 건너뛰어요.
   - 두 번 잇달아 못 하면 두 단계 아래로 내려가요.
   - "N단계 통과 + N+1단계 미통과"가 확인되면 끝. 결과는 N단계.
   - 고3(12단계)을 통과하면 "고3 이상"으로 끝 (그 위는 재지 않아요). 지문은 많아야 7개. */

const LT_GRADES = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const LT_YEARS = [
  { key: 'none', label: '거의 처음이에요', short: '거의 처음', off: -4 },
  { key: 'lt1', label: '1년이 안 됐어요', short: '1년 미만', off: -3 },
  { key: '1to2', label: '1~2년', short: '1~2년', off: -2 },
  { key: 'gt3', label: '3년 이상', short: '3년 이상', off: -1 },
];
const LT_MAX_STEPS = 7;
const LT_PASS = 2;
const LT_FAST = 0.6;

// 반 이름은 예시예요. 실제로는 학원 설정에서 바꿔 써요.
const LT_CLASSES = [
  { min: 0, max: 2, name: '파닉스, 첫 리딩반' },
  { min: 3, max: 4, name: '초등 리딩 기초반' },
  { min: 5, max: 6, name: '초등 리딩 심화반' },
  { min: 7, max: 8, name: '중등 리딩, 구문반' },
  { min: 9, max: 10, name: '중등 심화, 고1 대비반' },
  { min: 11, max: 12, name: '고등 모의고사반' },
];

const LT_STUDY = {
  voc: '단계에 맞는 단어를 예문과 함께 외우고, 지문에서 모르는 낱말의 뜻을 앞뒤 문장으로 짐작해 봐요.',
  sen: '긴 문장을 주어와 동사로 끊어 읽고 해석하는 구문 연습을 해요. 강의실 판서 영상으로 복습할 수 있어요.',
  det: '질문의 핵심어를 먼저 보고, 지문에서 근거가 되는 문장을 찾아 표시하는 연습을 해요.',
  main: '문단마다 한 줄로 요약하고, 글 전체의 주제문을 찾는 연습을 해요.',
  inf: '빈칸, 심경 문제에서 답의 근거가 되는 문장을 찾아 이유를 말해 보는 연습을 해요.',
  flow: 'However, For example 같은 연결어의 역할을 익히고, 문장 순서를 맞춰 보는 연습을 해요.',
};

function ltClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ltStartLevel(grade, years) {
  const y = LT_YEARS.find((x) => x.key === years) || LT_YEARS[2];
  return ltClamp(grade + y.off, 1, 11);
}

function ltWords(text) {
  if (!text) return 0;
  return text.replace(/__/g, '').replace(/\{A\}|\{_\}/g, ' ').replace(/\(\s*[①②③④⑤]\s*\)/g, ' ')
    .split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

function ltScore(level, answers) {
  const items = LT_BANK[level].items;
  const correct = items.map((it, i) => answers[i] === it.a);
  return { correct, score: correct.filter(Boolean).length };
}

// 지금까지 기록(steps)을 보고 다음 단계 또는 끝을 정해요.
// 돌려주는 값: { done: false, level } 또는 { done: true, result, top }
function ltNext(steps) {
  const passed = {};
  steps.forEach((s) => { passed[s.level] = s.pass; });
  const last = steps[steps.length - 1];
  const L = last.level;
  if (last.pass) {
    if (L === 12) return { done: true, result: 12, top: true };
    const failsAbove = steps.filter((s) => !s.pass && s.level > L).map((s) => s.level);
    const cap = failsAbove.length ? Math.min(...failsAbove) - 1 : 12;
    const lim = last.limit ? last.limit * 1000 : LT_LEVELS[L].time * 1000;
    const fast = last.score === 3 && last.ms <= lim * LT_FAST;
    const nxt = Math.min(L + (fast ? 2 : 1), cap);
    if (nxt <= L) return { done: true, result: L };
    if (steps.length >= LT_MAX_STEPS) return { done: true, result: L, capped: true };
    return { done: false, level: nxt, jumped: nxt - L > 1 };
  }
  const passBelow = steps.filter((s) => s.pass && s.level < L).map((s) => s.level);
  const floor = passBelow.length ? Math.max(...passBelow) : 0;
  if (floor === L - 1) return { done: true, result: floor };
  const prev = steps[steps.length - 2];
  const twoFails = prev && !prev.pass;
  const nxt = Math.max(L - (twoFails ? 2 : 1), floor + 1, 1);
  if (L === 1) return { done: true, result: 0 };
  if (steps.length >= LT_MAX_STEPS) return { done: true, result: floor, capped: true };
  return { done: false, level: nxt, jumped: L - nxt > 1 };
}

function ltLevelName(lv) {
  if (lv <= 0) return { short: '초1 전', name: '초등학교 1학년 전 단계' };
  return LT_LEVELS[lv];
}

function ltGiven(name) {
  const n = (name || '').trim();
  const g = n.length === 3 ? n.slice(1) : n;
  const c = g.charCodeAt(g.length - 1);
  const batchim = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return { plain: g, i: batchim ? g + '이' : g };
}

// 응시 기록 → 리포트에 쓰는 분석
function ltAnalyze(session) {
  const st = session.student;
  const fin = ltNext(session.steps);
  const result = fin.done ? fin.result : Math.max(0, ...session.steps.filter((s) => s.pass).map((s) => s.level));
  const top = !!fin.top;
  const G = st.grade;
  const diff = result - G;
  const items = [];
  session.steps.forEach((s, si) => {
    LT_BANK[s.level].items.forEach((it, i) => {
      items.push({ step: si, level: s.level, i, skill: it.skill, tag: it.tag, ok: s.correct[i], pick: s.answers[i], a: it.a, q: it.q, why: it.why });
    });
  });
  const skills = {};
  LT_SKILL_ORDER.forEach((k) => {
    const mine = items.filter((x) => x.skill === k);
    const total = mine.length;
    const correct = mine.filter((x) => x.ok).length;
    const below = mine.filter((x) => x.level <= result);
    const above = mine.filter((x) => x.level > result);
    const missBelow = below.filter((x) => !x.ok);
    const hitAbove = above.filter((x) => x.ok);
    const missAbove = above.filter((x) => !x.ok);
    let status = 'ok';
    if (!total) status = 'none';
    else if (result <= 0) status = 'ok';
    else if (missBelow.length) status = 'work';
    else if (hitAbove.length || (total >= 3 && correct === total)) status = 'strong';
    else if (!below.length && missAbove.length) status = 'next';
    let note = '';
    if (status === 'none') note = '이번 시험 경로에는 나오지 않았어요.';
    else if (result <= 0) note = `초1 지문에서 ${total}문항 중 ${correct}개를 맞혔어요.`;
    else if (status === 'work') note = `${ltLevelName(missBelow[0].level).short} 지문의 ${missBelow[0].tag} 문제를 틀렸어요.`;
    else if (hitAbove.length) note = `한 단계 위 ${ltLevelName(hitAbove[0].level).short} 지문에서도 맞혔어요.`;
    else if (status === 'next') note = `${ltLevelName(missAbove[0].level).short} 지문에서 틀렸어요. 다음 단계에서 키울 힘이에요.`;
    else if (missAbove.length) note = `자기 수준에서는 맞혔고, ${ltLevelName(missAbove[0].level).short} 지문에서 틀렸어요.`;
    else note = '나온 문제를 모두 맞혔어요.';
    skills[k] = { key: k, name: LT_SKILLS[k].name, total, correct, status, note, missBelow, hitAbove, missAbove };
  });
  const strong = LT_SKILL_ORDER.filter((k) => skills[k].status === 'strong');
  const work = LT_SKILL_ORDER.filter((k) => skills[k].status === 'work');
  const next = LT_SKILL_ORDER.filter((k) => (skills[k].status === 'ok' || skills[k].status === 'next') && skills[k].missAbove.length);
  const totalItems = items.length;
  const totalCorrect = items.filter((x) => x.ok).length;
  const totalMs = session.steps.reduce((a, s) => a + s.ms, 0);
  const own = session.steps.find((s) => s.level === result);
  const speed = own ? { level: result, words: ltWords(LT_BANK[result].passage), ms: own.ms, rec: (own.limit || LT_LEVELS[result].time) * 1000 } : null;
  const cls = LT_CLASSES.find((c) => result >= c.min && result <= c.max) || LT_CLASSES[0];
  const a = {
    student: st, date: session.date, result, top, capped: !!fin.capped, G, diff,
    level: ltLevelName(result), grade: LT_LEVELS[G],
    steps: session.steps, startLevel: session.steps[0] ? session.steps[0].level : null,
    items, skills, strong, work, next, totalItems, totalCorrect, totalMs, speed, recClass: cls.name,
  };
  a.headline = ltHeadline(a);
  a.comment = ltComment(a);
  a.plan = ltPlan(a);
  return a;
}

const LT_NUM = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한'];

function ltHas(word) {
  const c = word.charCodeAt(word.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
}
function ltJ(word, withB, noB) { return word + (ltHas(word) ? withB : noB); }
function ltAnd(words) {
  if (words.length <= 1) return words.join('');
  if (words.length >= 3) return words.join(', ');
  return ltJ(words[0], '과', '와') + ' ' + words[1];
}

function ltCompare(a) {
  if (a.top) return '이 시험으로 잴 수 있는 가장 높은 단계예요';
  if (a.result <= 0) return '알파벳 소리부터 차근차근 시작하면 돼요';
  if (a.diff > 0) return `지금 학년보다 ${LT_NUM[a.diff]} 단계 앞서요`;
  if (a.diff === 0) return '지금 학년에 맞는 수준이에요';
  return `지금 학년까지 ${LT_NUM[-a.diff]} 단계 남았어요`;
}

function ltHeadline(a) {
  if (a.top) return '고3(수능) 수준 지문까지 통과했어요';
  if (a.result <= 0) return '아직 초1 지문이 조금 어려워요';
  return `${a.level.name} 수준의 글을 읽을 수 있어요`;
}

const LT_POWER = { voc: '어휘력', sen: '문장 해석력', det: '세부 내용을 찾는 힘', main: '중심 내용을 잡는 힘', inf: '추론하는 힘', flow: '글의 흐름을 읽는 힘' };
const LT_FOCUS = { voc: '어휘', sen: '긴 문장 끊어 읽기', det: '근거 문장 찾기', main: '주제 잡기', inf: '근거로 추론하기', flow: '연결어와 글의 흐름' };

// 선생님 의견 초안 (선생님이 고쳐서 보내요)
function ltComment(a) {
  const nm = ltGiven(a.student.name).i + '는';
  const out = [];
  if (a.result <= 0) {
    return `${nm} 지금 알파벳 소리를 익히는 단계예요. 수업에서는 알파벳 소리와 짧은 낱말 읽기부터 차근차근 시작하려고 해요.`;
  }
  if (a.top) out.push(`${nm} 고3 수능 수준의 글까지 안정적으로 읽어요.`);
  else out.push(`${nm} ${a.level.name} 수준의 글을 무리 없이 읽어요. ${ltCompare(a)}.`);
  if (a.strong.length) {
    const ks = a.strong.slice(0, 2);
    const names = ltJ(ltAnd(ks.map((k) => LT_POWER[k])), '이', '가');
    const above = ks.map((k) => a.skills[k].hitAbove[0]).find(Boolean);
    out.push(above
      ? `특히 ${names} 좋아서, 한 단계 위인 ${ltLevelName(above.level).short} 지문에서도 맞혔어요.`
      : `특히 ${names} 좋아요.`);
  }
  if (a.work.length) {
    const s = a.skills[a.work[0]];
    out.push(`다만 ${s.missBelow[0].tag} 문제에서 실수가 있었어요.`);
  }
  if (a.top) {
    out.push('수업에서는 수능 고난도 유형(빈칸, 순서, 문장 넣기)과 시간 관리를 중심으로 다지려고 해요.');
    return out.join(' ');
  }
  const focus = [...a.work, ...a.next].slice(0, 2);
  if (focus.length) {
    const nextLv = ltLevelName(Math.min(12, Math.max(1, a.result + 1))).short;
    const what = ltJ(ltAnd(focus.map((k) => LT_FOCUS[k])), '을', '를');
    out.push(`수업에서는 ${what} 먼저 다지고 ${nextLv} 수준 지문으로 넘어가려고 해요.`);
  }
  return out.join(' ');
}

function ltPlan(a) {
  if (a.result <= 0) {
    return [
      { key: 'phonics', name: '알파벳 소리', text: '알파벳 26자의 이름과 소리를 익히고, 소리를 이어 짧은 낱말을 읽어요.' },
      { key: 'sight', name: '자주 쓰는 낱말', text: 'I, a, the, is처럼 자주 나오는 낱말을 보자마자 읽는 연습을 해요.' },
    ];
  }
  const keys = [...a.work, ...a.next];
  LT_SKILL_ORDER.forEach((k) => { if (keys.length < 3 && !keys.includes(k) && a.skills[k].status !== 'strong' && a.skills[k].total) keys.push(k); });
  return keys.slice(0, 3).map((k) => ({ key: k, name: LT_SKILLS[k].name, text: LT_STUDY[k] }));
}

function ltClock(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
}

function ltMessage(a, academy) {
  const nm = a.student.name;
  const lines = [
    `[${academy}] ${nm} 학생 리딩 레벨테스트 결과를 보내 드려요.`,
    '',
    `결과: ${a.top ? '고3(수능) 수준 이상' : a.level.name + ' 수준'} (${ltCompare(a)})`,
  ];
  if (a.strong.length) lines.push(`강점: ${a.strong.map((k) => LT_SKILLS[k].name).join(', ')}`);
  if (a.work.length) lines.push(`보완할 점: ${a.work.map((k) => LT_SKILLS[k].name).join(', ')}`);
  lines.push(`추천 과정: ${a.recClass}`);
  lines.push('', '자세한 결과는 아래 링크에서 보시고 PDF로 저장하실 수 있어요.', '{리포트 링크}', '', '궁금하신 점은 편하게 연락 주세요.');
  return lines.join('\n');
}

// ===== scales.js =====
/* 12단계와 바깥 지수 (초안 — 학생 데이터와 외부 공식 점수로 계속 보정해요)
   - CEFR: 영역마다 같은 표를 써요.
   - 렉사일 참고: MetaMetrics의 CEFR 정렬표(A1 535L 미만, A2 540~800L, B1 805~1090L, B2 1095~1320L)를
     단계별로 나눈 학원 기준. 공식 렉사일 지수가 아니에요.
   - AR 참고: 수능 평균 ATOS 10.2, 영어Ⅱ 교과서 평균 8.2(르네상스 분석)를 위쪽 기준으로 잡은 학원 기준.
   - 어휘량: 2022 개정 교육과정(초등 누계 600, 중학교 1,500, 공통영어 1,800, 영어Ⅱ 2,500)보다
     학원 아이들 실제에 맞춰 높게 잡은 초안. */
const LT_SCALE = [
  null,
  { lv: 1, cefr: 'Pre-A1', lex: [null, 0], ar: [0.5, 1.0], vocab: 0 },
  { lv: 2, cefr: 'Pre-A1', lex: [null, 150], ar: [1.0, 1.5], vocab: 150 },
  { lv: 3, cefr: 'A1', lex: [100, 250], ar: [1.5, 2.0], vocab: 350 },
  { lv: 4, cefr: 'A1', lex: [200, 350], ar: [2.0, 2.5], vocab: 600 },
  { lv: 5, cefr: 'A1', lex: [300, 450], ar: [2.5, 3.0], vocab: 900 },
  { lv: 6, cefr: 'A1+', lex: [400, 550], ar: [3.0, 3.5], vocab: 1200 },
  { lv: 7, cefr: 'A2', lex: [540, 670], ar: [3.5, 4.3], vocab: 1500 },
  { lv: 8, cefr: 'A2', lex: [670, 800], ar: [4.3, 5.0], vocab: 1900 },
  { lv: 9, cefr: 'A2+', lex: [750, 900], ar: [5.0, 6.0], vocab: 2300 },
  { lv: 10, cefr: 'B1', lex: [805, 1000], ar: [6.0, 7.0], vocab: 2700 },
  { lv: 11, cefr: 'B1+', lex: [950, 1090], ar: [7.0, 8.5], vocab: 3200 },
  { lv: 12, cefr: 'B2', lex: [1095, 1320], ar: [8.5, 10.5], vocab: 3800 },
];

function ltCefr(lv, top) {
  if (lv <= 0) return 'Pre-A1';
  return top && lv === 12 ? 'B2 이상' : LT_SCALE[lv].cefr;
}
function ltLexText(lv) {
  if (lv <= 0) return 'BR';
  const [a, b] = LT_SCALE[lv].lex;
  if (a == null) return b <= 0 ? 'BR (0L 아래)' : `BR~${b}L`;
  return `${a}~${b}L`;
}
function ltArText(lv) {
  if (lv <= 0) return '0.5 아래';
  const [a, b] = LT_SCALE[lv].ar;
  return `${a.toFixed(1)}~${b.toFixed(1)}`;
}
function ltVocabLevel(size) {
  if (size < 60) return 0;
  let lv = 1;
  for (let i = 1; i <= 12; i++) if (size >= LT_SCALE[i].vocab) lv = i;
  return lv;
}

/* 문항별 제한 시간 (기본값, 초). 학생이 30명 넘게 풀면 자동으로 다시 잡아요. */
const LT_WPM = [0, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140];
const LT_ANSWER = { voc: 25, det: 35, main: 35, sen: 45, inf: 45, flow: 40 };
const r5 = (x) => Math.max(5, Math.round(x / 5) * 5);
function ltReadLimits(level) {
  const b = LT_BANK[level];
  const words = ltWords(b.passage);
  const extra = level >= 10 ? 10 : level <= 2 ? 5 : 0;
  const read = words ? 1.2 * (words / LT_WPM[level]) * 60 : 0;
  return b.items.map((it, i) => r5((i === 0 ? read : 0) + (b.passage ? LT_ANSWER[it.skill] + extra : 30)));
}
function ltGramLimit(level) { return level <= 4 ? 25 : level <= 8 ? 30 : level <= 10 ? 40 : 60; }
function ltListenLimit(level) { return level <= 6 ? 15 : level <= 9 ? 20 : 25; }
function ltVocabLimit(band) { return LT_VBANDS[band - 1].time; }

/* 학원 교재 목록 (예시예요. 선생님이 레벨테스트 화면의 교재 목록에서 학원 교재로 바꿔 넣어요) */
const LT_BOOKS_DEFAULT = [
  { skill: 'read', name: '리딩 입문 (파닉스, 사이트워드)', from: 1, to: 2, note: '그림책 읽기' },
  { skill: 'read', name: '초등 리딩 1', from: 3, to: 4, note: '' },
  { skill: 'read', name: '초등 리딩 2', from: 5, to: 6, note: '' },
  { skill: 'read', name: '중등 리딩 1', from: 7, to: 8, note: '설명문, 이야기' },
  { skill: 'read', name: '중등 리딩 2', from: 9, to: 10, note: '' },
  { skill: 'read', name: '고등 모의고사 독해', from: 11, to: 12, note: '유형별' },
  { skill: 'voc', name: '초등 필수 어휘', from: 1, to: 6, note: '' },
  { skill: 'voc', name: '중등 필수 어휘', from: 7, to: 9, note: '' },
  { skill: 'voc', name: '수능 어휘', from: 10, to: 12, note: '' },
  { skill: 'gram', name: '초등 문법 1', from: 1, to: 4, note: '' },
  { skill: 'gram', name: '초등 문법 2', from: 5, to: 6, note: '' },
  { skill: 'gram', name: '중등 문법 1', from: 7, to: 7, note: 'to부정사, 동명사' },
  { skill: 'gram', name: '중등 문법 2', from: 8, to: 8, note: '현재완료, 수동태, 관계사' },
  { skill: 'gram', name: '중등 문법 3', from: 9, to: 9, note: '' },
  { skill: 'gram', name: '고등 어법', from: 10, to: 12, note: '수능 어법' },
  { skill: 'listen', name: '초등 듣기', from: 1, to: 6, note: '' },
  { skill: 'listen', name: '중등 듣기평가 대비', from: 7, to: 9, note: '' },
  { skill: 'listen', name: '수능 듣기', from: 10, to: 12, note: '' },
  { skill: 'write', name: '문장 쓰기 첫걸음', from: 1, to: 4, note: '낱말→문장' },
  { skill: 'write', name: '초등 영작 (문장→문단)', from: 5, to: 6, note: '' },
  { skill: 'write', name: '중등 영작, 서술형', from: 7, to: 9, note: '조건 영작' },
  { skill: 'write', name: '고등 에세이 쓰기', from: 10, to: 12, note: '논설문' },
];

const LT_MODS = {
  voc: { name: '어휘', icon: 'Aa', mins: [3, 5] },
  gram: { name: '문법', icon: '문', mins: [5, 8] },
  read: { name: '리딩', icon: '읽', mins: [10, 25] },
  listen: { name: '듣기', icon: '듣', mins: [8, 12] },
  write: { name: '라이팅', icon: '쓰', mins: [8, 14] },
};
const LT_MOD_ORDER = ['voc', 'gram', 'read', 'listen', 'write'];
const LT_WEIGHT = { read: 0.3, voc: 0.2, gram: 0.2, listen: 0.15, write: 0.15 };

// ===== modules.js =====
/* 다섯 영역: 문항 묶음 만들기, 다음 단계 정하기, 분석, 종합, 교재 추천, 의견 초안 */

/* ---------- 문항 묶음 (한 단계 = 3문항, 어휘는 한 구간 = 4단어) ---------- */
function ltBlock(mod, key) {
  if (mod === 'voc') {
    const B = LT_VBANDS[key - 1];
    return B.items.map((it) => ({ mod, kind: 'voc', en: it.en, opts: it.opts, a: it.a, limit: B.time, key }));
  }
  if (mod === 'gram') {
    const G = LT_GBANK[key];
    return G.items.map((it) => ({ mod, kind: G.kind === 'error' ? 'gerr' : 'gfill', q: it.q, opts: it.opts, a: it.a, pt: it.pt, why: it.why, limit: ltGramLimit(key), key }));
  }
  if (mod === 'read') {
    const lims = ltReadLimits(key);
    return LT_BANK[key].items.map((it, i) => ({ mod, kind: 'read', ...it, limit: lims[i], key, i }));
  }
  if (mod === 'listen') {
    const S = LT_LBANK[key];
    return S.items.map((it, i) => ({ mod, kind: S.kind === 'set' ? 'lset' : 'lone', ...it, limit: ltListenLimit(key), key, i, plays: S.kind === 'set' ? S.plays : 2 }));
  }
  return [];
}
function ltBlockLimit(mod, key) { return ltBlock(mod, key).reduce((a, it) => a + it.limit, 0); }

/* ---------- 시작 단계 ---------- */
function ltVocStart(grade) { return grade <= 2 ? 1 : grade <= 4 ? 2 : grade <= 6 ? 3 : grade <= 9 ? 4 : 5; }
function ltModStart(mod, st, ctx) {
  const base = st.kind === 'member' && st.last ? ltClamp(st.last, 1, 11) : ltStartLevel(st.grade, st.years);
  // 어휘를 먼저 봤으면, 어휘 레벨이 학년보다 낮을 때 시작을 낮춰요
  const v = ctx && ctx.voc != null ? ctx.voc : null;
  if (v != null && v < st.grade) return ltClamp(Math.min(base, v - 1), 1, 11);
  return base;
}

/* ---------- 다음 단계 ---------- */
function ltVocNext(steps, start) {
  const by = {};
  steps.forEach((s) => { by[s.key] = s.score; });
  const last = steps[steps.length - 1];
  const up = Math.max(...steps.map((s) => s.key));
  if (last.key === up && last.key >= start && last.score >= 2 && last.key < 9) return { done: false, key: last.key + 1 };
  const low = Math.min(...steps.map((s) => s.key));
  if (by[low] < 3 && low > 1) return { done: false, key: low - 1 };
  return { done: true };
}
function ltModNext(mod, steps, start) {
  if (mod === 'voc') return ltVocNext(steps, start);
  const n = ltNext(steps.map((s) => ({ level: s.key, score: s.score, pass: s.pass, ms: s.ms, limit: s.limit })));
  return n.done ? n : { done: false, key: n.level, jumped: n.jumped };
}
function ltScoreBlock(mod, key, answers, times) {
  const items = ltBlock(mod, key);
  const correct = items.map((it, i) => answers[i] === it.a);
  const score = correct.filter(Boolean).length;
  const ms = times.reduce((a, t) => a + t, 0);
  const limit = items.reduce((a, it) => a + it.limit, 0);
  return { key, answers, times, correct, score, pass: mod === 'voc' ? score >= 3 : score >= LT_PASS, ms, limit };
}

/* ---------- 영역별 분석 ---------- */
function ltAnalyzeVoc(steps) {
  if (!steps.length) return null;
  const by = {};
  steps.forEach((s) => { by[s.key] = s.score; });
  const keys = Object.keys(by).map(Number);
  const low = Math.min(...keys);
  let size = 0;
  const prof = LT_VBANDS.map((B) => {
    let p;
    if (by[B.b] != null) p = by[B.b] / 4;
    else if (B.b < low) p = by[low] >= 3 ? 1 : by[low] / 4;
    else p = 0;
    size += B.size * p;
    return { b: B.b, from: B.from, to: B.to, p, tested: by[B.b] != null, score: by[B.b] };
  });
  size = Math.round(size / 50) * 50;
  const level = ltVocabLevel(size);
  const items = [];
  steps.forEach((s) => LT_VBANDS[s.key - 1].items.forEach((it, i) => items.push({ band: s.key, en: it.en, ko: it.ko, ok: s.correct[i], pick: s.answers[i], opts: it.opts, t: s.times[i] })));
  return { mod: 'voc', level, size, prof, items, cefr: ltCefr(level) };
}

function ltAnalyzeLevel(mod, steps) {
  if (!steps.length) return null;
  const fin = ltModNext(mod, steps);
  const level = fin.done ? fin.result : Math.max(0, ...steps.filter((s) => s.pass).map((s) => s.key));
  const items = [];
  steps.forEach((s) => ltBlock(mod, s.key).forEach((it, i) => items.push({ level: s.key, pt: it.pt, q: it.q, ok: s.correct[i], pick: s.answers[i], a: it.a, opts: it.opts, why: it.why, t: s.times[i], limit: it.limit })));
  const known = [];
  const weak = [];
  items.forEach((x) => {
    if (x.ok && !known.includes(x.pt)) known.push(x.pt);
    if (!x.ok && x.level <= level + 1 && !weak.includes(x.pt)) weak.push(x.pt);
  });
  return { mod, level, top: !!fin.top, items, known: known.filter((p) => !weak.includes(p)), weak, cefr: ltCefr(level, fin.top), steps };
}

function ltNorm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function ltWordCount(s) { return String(s || '').split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length; }
function ltCondCheck(it, ans) {
  const low = ltNorm(ans).toLowerCase();
  const need = (it.need || []).map((w) => ({ w, ok: low.includes(w.toLowerCase()) }));
  return { need, words: ltWordCount(ans) };
}
function ltWriteTier(level) { return level <= 4 ? 'A' : level <= 8 ? 'B' : 'C'; }

function ltAnalyzeWrite(w) {
  if (!w) return null;
  const T = LT_WBANK[w.tier];
  const sc = w.scoring || null;
  let autoOk = 0;
  let autoN = 0;
  let condPts = 0;
  let condMax = 0;
  let condDone = true;
  const rows = T.items.map((it) => {
    const ans = w.answers[it.id];
    if (it.kind === 'spell' || it.kind === 'order') {
      const ok = it.answer.some((x) => ltNorm(x) === ltNorm(ans));
      autoN++; if (ok) autoOk++;
      return { it, ans, ok, auto: true };
    }
    if (it.kind === 'cond') {
      const r = sc && sc.items ? sc.items.find((x) => x.id === it.id) : null;
      condMax += 2;
      if (r && r.points != null) condPts += r.points; else condDone = false;
      return { it, ans, score: r, check: ltCondCheck(it, ans) };
    }
    return { it, ans, essay: sc ? sc.essay : null, words: ltWordCount(ans) };
  });
  const essayRow = rows.find((r) => r.it.kind === 'essay');
  const rub = essayRow && essayRow.essay;
  const rubDone = !essayRow || (rub && LT_RUBRIC.every((k) => rub[k.key]));
  let level = null;
  if (w.tier === 'A') level = [1, 2, 3, 4][autoOk] || 1;
  else if (condDone && rubDone) {
    const r = rub ? LT_RUBRIC.reduce((a, k) => a + rub[k.key], 0) / LT_RUBRIC.length : 3;
    const c = (autoOk + condPts) / (autoN + condMax || 1);
    const comp = w.tier === 'B' ? 0.5 * c + 0.5 * ((r - 1) / 4) : 0.4 * c + 0.6 * ((r - 1) / 4);
    const base = w.tier === 'B' ? 5 : 9;
    level = comp < 0.15 ? base - 1 : base + Math.round(comp * 3);
  }
  const rubAvg = rub && rubDone ? LT_RUBRIC.reduce((a, k) => a + rub[k.key], 0) / LT_RUBRIC.length : null;
  return { mod: 'write', tier: w.tier, tierName: T.name, rows, level, scored: level != null, autoOk, autoN, condPts, condMax, rub, rubAvg, errors: rub && rub.errors ? rub.errors : [], summary: rub && rub.summary, by: sc && sc.by, cefr: level != null ? ltCefr(level) : null };
}

/* ---------- 종합 ---------- */
function ltOverall(mods) {
  let s = 0;
  let sw = 0;
  Object.keys(mods).forEach((k) => {
    const m = mods[k];
    if (m && m.level != null) { s += LT_WEIGHT[k] * m.level; sw += LT_WEIGHT[k]; }
  });
  if (!sw) return null;
  const v = s / sw;
  const level = Math.round(v);
  return { value: Math.round(v * 10) / 10, level, cefr: ltCefr(level) };
}

function ltPickBook(books, skill, level) {
  const list = books.filter((b) => b.skill === skill);
  if (!list.length || level == null) return null;
  const L = Math.max(1, level);
  const inRange = list.filter((b) => b.from <= L && L <= b.to);
  const cands = (inRange.length ? inRange : list).slice();
  cands.sort((x, y) => Math.abs((x.from + x.to) / 2 - L) - Math.abs((y.from + y.to) / 2 - L));
  return cands[0];
}

const LT_MODNAME = { voc: '어휘', gram: '문법', read: '리딩', listen: '듣기', write: '라이팅' };

function ltAnalyzeAll(session, books) {
  const st = session.student;
  const R = session.res || {};
  const mods = {};
  if (R.voc) mods.voc = ltAnalyzeVoc(R.voc.steps);
  if (R.gram) mods.gram = ltAnalyzeLevel('gram', R.gram.steps);
  if (R.read && R.read.steps.length) {
    const ra = ltAnalyze({ student: st, date: session.date, steps: R.read.steps.map((s) => ({ level: s.key, answers: s.answers, correct: s.correct, score: s.score, pass: s.pass, ms: s.ms, limit: s.limit })) });
    ra.mod = 'read';
    ra.level = ra.result;
    ra.cefr = ltCefr(ra.result, ra.top);
    ra.fk = ra.result >= 1 && LT_BANK[ra.result].passage ? ltFK(LT_BANK[ra.result].passage) : null;
    mods.read = ra;
  }
  if (R.listen) mods.listen = ltAnalyzeLevel('listen', R.listen.steps);
  if (R.write) mods.write = ltAnalyzeWrite(R.write);
  const overall = ltOverall(mods);
  const bk = {};
  Object.keys(mods).forEach((k) => { if (mods[k] && mods[k].level != null) bk[k] = ltPickBook(books, k, mods[k].level); });
  const a = { student: st, date: session.date, mods, overall, books: bk, G: st.grade, order: LT_MOD_ORDER.filter((k) => mods[k]) };
  a.comment = ltComment2(a);
  a.plan = ltPlan2(a);
  return a;
}

/* ---------- 의견 초안·공부 방향 ---------- */
function ltLvShort(lv) { return lv <= 0 ? '초1 전' : LT_LEVELS[lv].short; }
function ltCmp(diff) {
  if (diff > 0) return `지금 학년보다 ${LT_NUM[diff]} 단계 앞서요`;
  if (diff === 0) return '지금 학년에 맞는 수준이에요';
  return `지금 학년까지 ${LT_NUM[-diff]} 단계 남았어요`;
}
function ltPtShort(pt) { return String(pt || '').replace(/\s*\(.*?\)\s*/g, '').trim(); }
function ltWeakLine(k, m) {
  const s = ltLvShort(m.level);
  if (k === 'gram') {
    const pts = m.weak.slice(0, 2).map(ltPtShort);
    return pts.length ? `문법은 ${s} 수준이라 ${ltJ(pts.join(', '), '을', '를')} 아직 헷갈려요.` : `문법은 ${s} 수준이에요.`;
  }
  if (k === 'write') return `라이팅은 ${s} 수준이라 읽을 수 있는 문장을 직접 쓰는 힘이 아직 따라오지 못하고 있어요.`;
  if (k === 'voc') return `어휘는 ${s} 수준이라 글 속 낯선 낱말에서 막히는 일이 있어요.`;
  if (k === 'listen') return `듣기는 ${s} 수준이라 긴 대화에서 세부 정보를 놓치기도 해요.`;
  return `리딩은 ${s} 수준이라 긴 글에서 문장 구조를 놓치기도 해요.`;
}
function ltComment2(a) {
  const nm = ltGiven(a.student.name).i + '는';
  const ks = a.order.filter((k) => a.mods[k] && a.mods[k].level != null);
  if (!ks.length) return '';
  const top = Math.max(...ks.map((k) => a.mods[k].level));
  if (top <= 0) return `${nm} 지금 알파벳 소리와 기초 낱말을 익히는 단계예요. 수업에서는 소리 내어 읽기와 기초 낱말부터 차근차근 시작하려고 해요.`;
  const topKs = ks.filter((k) => a.mods[k].level === top);
  const out = [];
  out.push(`${nm} ${ltJ(ltAnd(topKs.map((k) => LT_MODNAME[k])), '이', '가')} ${ltLvShort(top)} 수준이에요. ${ltCmp(top - a.G)}.`);
  const low = ks.filter((k) => a.mods[k].level <= top - 1).sort((x, y) => a.mods[x].level - a.mods[y].level).slice(0, 2);
  low.forEach((k) => out.push(ltWeakLine(k, a.mods[k])));
  const parts = low.filter((k) => a.books[k]).map((k) => `${ltJ(LT_MODNAME[k], '은', '는')} '${a.books[k].name}' 교재`);
  if (low.length && parts.length) {
    const rest = a.books.read && !low.includes('read') ? `, 리딩은 '${a.books.read.name}' 교재로 지금 실력을 이어 갈게요` : '';
    out.push(`수업에서는 ${ltJ(ltAnd(low.map((k) => LT_MODNAME[k])), '을', '를')} 먼저 끌어올리려고 해요. ${parts.join(', ')}로 시작하고${rest}.`);
  } else if (a.books.read) {
    out.push(`수업에서는 '${a.books.read.name}' 교재로 지금 실력을 이어 가면서 한 단계 위 글에 도전하려고 해요.`);
  }
  return out.join(' ');
}
function ltPlan2(a) {
  const ks = a.order.filter((k) => a.mods[k] && a.mods[k].level != null);
  ks.sort((x, y) => a.mods[x].level - a.mods[y].level);
  return ks.map((k) => {
    const m = a.mods[k];
    let text = '';
    if (k === 'gram') text = m.weak.length ? `${m.weak.slice(0, 3).map(ltPtShort).join(', ')}부터 다져요. 배운 문법으로 문장을 바꿔 써 보며 익혀요.` : '다음 단계 문법으로 넘어가며 문장 바꿔 쓰기를 함께 해요.';
    else if (k === 'write') text = m.errors && m.errors.length ? `한 문장씩 쓰고 고친 문장을 다시 써 보는 연습을 해요. 이번에 나온 실수(${m.errors.slice(0, 2).map((e) => `${e.wrong} → ${e.right}`).join(', ')})부터 점검해요.` : '배운 문법으로 한 문장씩 쓰고, 3~5문장 문단으로 넓혀 가요.';
    else if (k === 'voc') text = `단계에 맞는 단어를 예문과 함께 외우고, 주마다 확인 시험을 봐요. 지금 아는 낱말은 약 ${m.size.toLocaleString()}개로 짐작돼요.`;
    else if (k === 'listen') text = '대화를 듣고 핵심어 받아쓰기, 숫자, 시간 메모 연습을 해요.';
    else text = (m.plan && m.plan[0] ? m.plan[0].text : '한 단계 위 지문으로 꾸준히 읽어요.');
    return { key: k, name: LT_MODNAME[k], level: m.level, book: a.books[k] ? a.books[k].name : null, text };
  });
}

/* ---------- 문항 통계 예시 (가상 학생으로 계산) ---------- */
function ltSimStats(N) {
  let x = 20261024;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const nrm = () => { let u = 0; let v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const VLV = [0, 2, 3, 5, 7, 9, 10, 11, 12, 12];
  const OFF = { 'read-9-1': 1.8, 'gram-3-0': -2.2, 'listen-8-0': 1.2 };
  const rows = [];
  ['read', 'gram', 'listen'].forEach((mod) => {
    for (let lv = 1; lv <= 12; lv++) ltBlock(mod, lv).forEach((it, i) => rows.push({ mod, lv, i, id: `${mod}-${lv}-${i}`, label: mod === 'read' ? `${LT_BANK[lv].title} ${i + 1}번` : (it.pt || '') + (mod === 'listen' ? ` ${i + 1}번` : ''), def: it.limit, opts: it.opts.length }));
  });
  LT_VBANDS.forEach((B) => B.items.forEach((it, i) => rows.push({ mod: 'voc', lv: VLV[B.b], band: B.b, i, id: `voc-${B.b}-${i}`, label: it.en, def: B.time, opts: 4 })));
  rows.forEach((r) => { r.n = 0; r.same = [0, 0]; r.times = []; r.off = OFF[r.id] || 0; });
  for (let s = 0; s < N; s++) {
    const T = ltClamp(Math.round(6.5 + nrm() * 2.6), 1, 12);
    rows.forEach((r) => {
      if (r.lv < T - 2 || r.lv > T + 1) return;
      const c = 1 / r.opts;
      const p = c + (1 - c) / (1 + Math.exp(-1.7 * (T - r.lv + 0.6 - r.off)));
      let ok = rnd() < p;
      const med = r.def * (ok ? 0.48 + 0.06 * (r.lv - T) : 0.72);
      const t = Math.max(2, med * Math.exp(0.33 * nrm()));
      if (t > r.def) ok = false;
      r.n++;
      if (T === r.lv) { r.same[1]++; if (ok) r.same[0]++; }
      if (ok && T >= r.lv) r.times.push(Math.min(t, r.def));
    });
  }
  rows.forEach((r) => {
    r.times.sort((a, b) => a - b);
    const q = (p) => (r.times.length ? r.times[Math.min(r.times.length - 1, Math.floor(p * r.times.length))] : null);
    r.med = q(0.5);
    r.p90 = q(0.9);
    r.p = r.same[1] ? r.same[0] / r.same[1] : null;
    const lo = Math.ceil((r.def * 0.7) / 5) * 5;
    const hi = Math.floor((r.def * 1.5) / 5) * 5;
    r.adj = r.n >= 30 && r.p90 ? Math.min(hi, Math.max(lo, r5(r.p90 * 1.1))) : r.def;
    r.flag = r.p != null && r.same[1] >= 12 ? (r.p < 0.45 ? 'hard' : r.p >= 0.98 ? 'easy' : '') : '';
  });
  return rows;
}

// ===== report.js =====
/* 어머니께 보내는 리포트 (화면·PDF 같이 써요) */

function ltEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function ltDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}
function ltAddMonths(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  const t = m - 1 + n;
  return `${y + Math.floor(t / 12)}년 ${(t % 12) + 1}월`;
}
function ltMin(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? '1분 안' : `${m}분`;
}

// 12단계 계단 (칠판 위)
function ltStairSVG(result, G) {
  const n = 12, gap = 3.6, W = 336, base = 88;
  const w = (W - gap * (n - 1)) / n;
  let s = '';
  for (let i = 1; i <= n; i++) {
    const x = (i - 1) * (w + gap);
    const h = 12 + i * 6;
    const cls = i === result ? 'st-top' : i < result ? 'st-on' : 'st-off';
    s += `<rect class="${cls}" x="${x.toFixed(1)}" y="${base - h}" width="${w.toFixed(1)}" height="${h}" rx="2.5"/>`;
    const cx = x + w / 2;
    s += `<text class="st-lb${i === G ? ' st-g' : ''}${i === result ? ' st-r' : ''}" x="${cx.toFixed(1)}" y="${base + 13}" text-anchor="middle">${LT_LEVELS[i].short}</text>`;
    if (i === G) s += `<path class="st-tri" d="M${(cx - 4).toFixed(1)} ${base + 23}L${(cx + 4).toFixed(1)} ${base + 23}L${cx.toFixed(1)} ${base + 17}Z"/>`;
  }
  return `<svg class="rp-stair-svg" viewBox="0 0 ${W} ${base + 26}" role="img" aria-label="12단계 가운데 ${Math.max(0, result)}단계">${s}</svg>`;
}

// 시험 경로 (지문마다 단계와 맞힌 수)
function ltPathSVG(steps, result, G, wide) {
  const W = wide ? 540 : 340, H = wide ? 178 : 212, L = 38, R = W - 10, T = 16, B = H - 32;
  const Y = (lv) => +(B - ((lv - 1) * (B - T)) / 11).toFixed(1);
  const n = steps.length;
  const x0 = L + 30;
  const dx = n > 1 ? Math.min(wide ? 84 : 64, (R - 60 - x0) / (n - 1)) : 0;
  const X = (i) => +(x0 + i * dx).toFixed(1);
  let g = '';
  if (result >= 1) g += `<rect class="pc-band" x="${L}" y="${Y(result) - 7}" width="${R - L}" height="14" rx="3"/>`;
  for (let lv = 1; lv <= 12; lv++) {
    g += `<line class="pc-grid" x1="${L}" x2="${R}" y1="${Y(lv)}" y2="${Y(lv)}"/>`;
    g += `<text class="pc-y${lv === result ? ' pc-yr' : ''}" x="${L - 6}" y="${Y(lv) + 3}" text-anchor="end">${LT_LEVELS[lv].short}</text>`;
  }
  g += `<line class="pc-grade" x1="${L}" x2="${R}" y1="${Y(G)}" y2="${Y(G)}"/>`;
  g += `<text class="pc-gl" x="${R}" y="${Y(G) + 11}" text-anchor="end">지금 학년</text>`;
  if (n > 1) g += `<polyline class="pc-line" points="${steps.map((s, i) => `${X(i)},${Y(s.level)}`).join(' ')}"/>`;
  steps.forEach((s, i) => {
    g += `<circle class="${s.pass ? 'pc-ok' : 'pc-no'}" cx="${X(i)}" cy="${Y(s.level)}" r="5.5"/>`;
    g += `<text class="pc-sc${s.pass ? '' : ' no'}" x="${X(i)}" y="${Y(s.level) - 10}" text-anchor="middle">${s.score}/3</text>`;
    g += `<text class="pc-x" x="${X(i)}" y="${B + 24}" text-anchor="middle">지문 ${i + 1}</text>`;
  });
  return `<svg class="rp-path-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="지문 ${n}개의 단계와 맞힌 문항 수">${g}</svg>`;
}

const LT_CHIP = { strong: '강점', ok: '안정', next: '다음 단계', work: '보완', none: '안 나옴' };

function ltSkillHTML(a) {
  return LT_SKILL_ORDER.map((k) => {
    const s = a.skills[k];
    const dots = a.items.filter((x) => x.skill === k)
      .map((x) => `<span class="rp-dot ${x.ok ? 'ok' : 'no'}"><i></i>${LT_LEVELS[x.level].short}</span>`).join('');
    return `<div class="rp-skill">
      <div class="rp-skill-h"><b>${s.name}</b><span class="rp-chip ${s.status}">${LT_CHIP[s.status]}</span>${dots ? `<span class="rp-dots" aria-label="${s.total}문항 중 ${s.correct}개 맞힘">${dots}</span>` : ''}</div>
      <p class="rp-skill-d">${LT_SKILLS[k].long}</p>
      <p class="rp-skill-n">${ltEsc(s.note)}</p>
    </div>`;
  }).join('');
}

function ltSpeedText(a) {
  const sp = a.speed;
  if (!sp) return '';
  const lv = LT_LEVELS[sp.level].short;
  const within = sp.ms <= sp.rec;
  return `자기 수준인 ${lv} 지문(${sp.words}단어)을 ${ltClock(sp.ms)}에 읽고 풀었어요. ${within ? `권장 시간 ${Math.round(sp.rec / 60000)}분 안이에요.` : `권장 시간 ${Math.round(sp.rec / 60000)}분보다 조금 더 걸렸어요.`}`;
}

// a: ltAnalyze 결과, o: { academy, comment, recClass, print, sample }
function ltReportHTML(a, o) {
  const st = a.student;
  const lvBig = a.result <= 0 ? '시작' : a.level.short;
  const pathRange = a.steps.length ? `${LT_LEVELS[a.steps[0].level].short}부터` : '';
  const comment = o.comment != null ? o.comment : a.comment;
  const rec = o.recClass || a.recClass;
  const ribbon = o.sample ? '<span class="rp-ribbon">예시 리포트, 가상의 학생</span>' : '';

  const band = `<header class="rp-band">
    <div class="rp-band-top"><span class="rp-acad">${ltEsc(o.academy)}</span>${ribbon}</div>
    <div class="rp-band-main">
      <div class="rp-band-l">
        <h2 class="rp-title">리딩 레벨테스트 결과</h2>
        <p class="rp-who"><b>${ltEsc(st.name)}</b>${ltEsc(LT_LEVELS[st.grade].name)}${st.school ? ` <span class="rp-school">${ltEsc(st.school)}</span>` : ''}</p>
        <div class="rp-hero">
          <div class="rp-lv"><small>리딩 레벨</small><strong>${lvBig}</strong></div>
          <div class="rp-hero-t">
            <p class="rp-hl">${ltEsc(a.headline)}</p>
            <p class="rp-cmp">${ltEsc(ltCompare(a))}</p>
          </div>
        </div>
      </div>
      <div class="rp-band-r">
        <div class="rp-stair">${ltStairSVG(a.result, a.G)}</div>
        <p class="rp-legend"><span><i class="lg-lv"></i>${ltEsc(ltGiven(st.name).plain)}의 레벨까지</span><span><i class="lg-g"></i>지금 학년</span></p>
      </div>
    </div>
  </header>`;

  const facts = `<section class="rp-sec rp-facts">
    <dl>
      <div><dt>응시일</dt><dd>${ltDate(a.date)}</dd></div>
      <div><dt>읽은 지문</dt><dd class="num">${a.steps.length}개 <small class="in">${pathRange}</small></dd></div>
      <div><dt>맞힌 문항</dt><dd class="num">${a.totalItems}문항 중 ${a.totalCorrect}개</dd></div>
      <div><dt>걸린 시간</dt><dd class="num">${ltMin(a.totalMs)}</dd></div>
    </dl>
    ${a.speed ? `<p class="rp-speed">${ltEsc(ltSpeedText(a))}</p>` : ''}
  </section>`;

  const skills = `<section class="rp-sec">
    <h3>영역별로 보면</h3>
    <p class="rp-sub"><span class="rp-dot ok"><i></i>맞힘</span><span class="rp-dot no"><i></i>틀림</span> 점 아래 글자는 그 문제가 나온 지문의 단계예요.</p>
    <div class="rp-skills">${ltSkillHTML(a)}</div>
  </section>`;

  const path = `<section class="rp-sec rp-pathsec">
    <h3>시험은 이렇게 진행됐어요</h3>
    <p class="rp-sub">지문 하나에 3문항이에요. 2개 이상 맞히면 한 단계 위, 못 하면 한 단계 아래 지문으로 가고, 통과한 단계 바로 위에서 막히면 끝나요.</p>
    <div class="rp-path">${ltPathSVG(a.steps, a.result, a.G, o.print)}</div>
    <p class="rp-legend2"><span><i class="lg-ok"></i>통과</span><span><i class="lg-no"></i>통과 못 함</span><span><i class="lg-band"></i>레벨</span><span><i class="lg-grade"></i>지금 학년</span></p>
  </section>`;

  const note = `<section class="rp-sec rp-note">
    <h3>선생님 의견</h3>
    <p class="rp-comment">${ltEsc(comment).replace(/\n/g, '<br>')}</p>
    <p class="rp-sign">${ltEsc(o.academy)} 담당 선생님</p>
  </section>`;

  const plan = `<section class="rp-sec">
    <h3>앞으로 이렇게 공부해요</h3>
    <p class="rp-rec">추천 과정 <b>${ltEsc(rec)}</b></p>
    <ol class="rp-plan">${a.plan.map((p) => `<li><b>${ltEsc(p.name)}</b><span>${ltEsc(p.text)}</span></li>`).join('')}</ol>
  </section>`;

  const rows = LT_LEVELS.slice(1).map((L) => `<tr class="${L.lv === a.result ? 'is-lv' : ''}">
      <td class="num">${L.lv}</td><td><b>${L.short}</b>${L.lv === a.result ? '<em>레벨</em>' : ''}${L.lv === a.G ? '<em class="g">학년</em>' : ''}</td><td>${L.stage}</td><td>${L.desc}</td></tr>`).join('');
  const tableHTML = `<div class="rp-tablewrap"><table class="rp-table"><thead><tr><th>단계</th><th>학년</th><th>기준</th><th>읽는 글</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const tableSub = '<p class="rp-sub">우리나라 초1부터 고3까지 12단계예요. 단계마다 그 학년 교과서, 모의고사, 수능 지문 수준으로 만든 지문을 읽어요.</p>';
  const table = o.print
    ? `<section class="rp-sec"><h3>레벨은 이렇게 정해요</h3>${tableSub}${tableHTML}</section>`
    : `<section class="rp-sec"><h3>레벨은 이렇게 정해요</h3>${tableSub}<details class="rp-levels"><summary>12단계 기준 모두 보기</summary>${tableHTML}</details></section>`;

  const foot = `<footer class="rp-foot">
    <p>다음 레벨테스트는 <b>${ltAddMonths(a.date, 3)}</b>쯤 보시길 권해요.</p>
    <p>이 결과는 학교 교과서, 모의고사, 수능 지문의 난이도를 기준으로 ${ltEsc(o.academy)}가 만든 자체 평가예요. 공인 시험 점수와는 달라요. 짧은 시험이라 그날 컨디션에 따라 한 단계쯤 달라질 수 있어서, 수업하면서 함께 확인해 드릴게요.</p>
    <p>학생 정보와 결과는 학원 강의실에만 보관해요. 등록하지 않으면 6개월 뒤 지워요.</p>
  </footer>`;

  if (!o.print) {
    return `<article class="rp">${band}${facts}${skills}${path}${note}${plan}${table}${foot}</article>`;
  }
  const mini = `<div class="rp-mini"><span>${ltEsc(o.academy)} 리딩 레벨테스트</span><span>${ltEsc(st.name)}, ${ltDate(a.date)}</span></div>`;
  return `<article class="rp print">
    <div class="rp-sheet s1">${band}<div class="rp-body">${facts}${skills}${path}</div><div class="rp-pno">1 / 2</div></div>
    <div class="rp-sheet s2">${mini}<div class="rp-body">${note}${plan}${table}${foot}</div><div class="rp-pno">2 / 2</div></div>
  </article>`;
}

// ===== report2.js =====
/* 다섯 영역 리포트 (화면·PDF 같이 써요) */

// 영역별 레벨 사다리: 영역마다 12칸, 지금 학년은 세로 점선
function ltLadderSVG(a, wide) {
  const ks = a.order.filter((k) => a.mods[k]);
  const W = wide ? 560 : 340;
  const L = wide ? 64 : 50;
  const R = W - (wide ? 52 : 40);
  const top = 26;
  const rowH = wide ? 28 : 30;
  const H = top + ks.length * rowH + 8;
  const gap = wide ? 3 : 2;
  const sw = (R - L - gap * 11) / 12;
  const X = (i) => L + (i - 1) * (sw + gap);
  let g = '';
  for (let i = 1; i <= 12; i++) {
    const show = wide || i % 2 === 1 || i === 12;
    if (show) g += `<text class="ld-ax${i === a.G ? ' g' : ''}" x="${(X(i) + sw / 2).toFixed(1)}" y="12" text-anchor="middle">${LT_LEVELS[i].short}</text>`;
  }
  ks.forEach((k, r) => {
    const m = a.mods[k];
    const y = top + r * rowH;
    g += `<text class="ld-name" x="0" y="${y + 15}">${LT_MODNAME[k]}</text>`;
    for (let i = 1; i <= 12; i++) {
      const on = m.level != null && i <= m.level;
      const isTop = m.level != null && i === m.level;
      g += `<rect class="${isTop ? 'ld-top' : on ? 'ld-on' : 'ld-off'}" x="${X(i).toFixed(1)}" y="${y + 4}" width="${sw.toFixed(1)}" height="${rowH - 12}" rx="2"/>`;
    }
    g += `<text class="ld-lv" x="${W}" y="${y + 15}" text-anchor="end">${m.level == null ? '채점 전' : ltLvShort(m.level)}</text>`;
  });
  const gx = X(a.G) + sw / 2;
  g += `<line class="ld-g" x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="${top - 2}" y2="${H - 4}"/>`;
  return `<svg class="rp-ladder-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="영역별 레벨">${g}</svg>`;
}

function ltIdxTiles(a) {
  const r = a.mods.read;
  const v = a.mods.voc;
  const ov = a.overall;
  const lv = r ? r.level : ov ? ov.level : 0;
  const tiles = [
    { k: 'CEFR', v: ov ? ov.cefr : '-', s: r ? `리딩 ${r.cefr}` : '종합' },
    { k: '렉사일 참고', v: ltLexText(lv), s: '리딩 레벨 기준' },
    { k: 'AR 참고', v: ltArText(lv), s: '리딩 레벨 기준' },
    { k: '어휘량', v: v ? `약 ${v.size.toLocaleString()}개` : '-', s: v ? `${ltLvShort(v.level)} 수준` : '어휘 안 봄' },
  ];
  return `<div class="rp-idx">${tiles.map((t) => `<div class="rp-idx-t"><span>${t.k}</span><b class="num">${t.v}</b><small>${t.s}</small></div>`).join('')}</div>`;
}

function ltModLine(k, m, a) {
  if (k === 'read') return m.strong.length ? `${LT_SKILLS[m.strong[0]].name}이 강점, ${m.work.length ? LT_SKILLS[m.work[0]].name + ' 보완' : '고르게 안정적'}` : (m.work.length ? `${LT_SKILLS[m.work[0]].name} 보완` : '고르게 안정적');
  if (k === 'voc') return `아는 낱말 약 ${m.size.toLocaleString()}개`;
  if (k === 'gram') return m.weak.length ? `다질 문법 ${m.weak.length}개: ${m.weak.slice(0, 2).map(ltPtShort).join(', ')}` : '나온 문법을 모두 알아요';
  if (k === 'listen') return m.weak.length ? `${m.weak.slice(0, 2).join(', ')}에서 실수` : '나온 문제를 모두 맞혔어요';
  if (k === 'write') return m.scored ? `글쓰기 평균 ${m.rubAvg ? m.rubAvg.toFixed(1) : '-'}점 / 5점, 조건 영작 ${m.condPts}/${m.condMax}점` : '채점 전';
  return '';
}

function ltTimeStats(a) {
  let n = 0;
  let over = 0;
  let ratio = 0;
  let rn = 0;
  ['voc', 'gram', 'listen'].forEach((k) => {
    const m = a.mods[k];
    if (!m) return;
    m.items.forEach((x) => {
      n++;
      if (x.pick === -2) over++;
      const lim = x.limit || (k === 'voc' ? LT_VBANDS[x.band - 1].time : null);
      if (lim && x.t) { ratio += Math.min(1, x.t / 1000 / lim); rn++; }
    });
  });
  if (a.mods.read) {
    a.mods.read.steps.forEach((s) => {
      const lims = ltReadLimits(s.level);
      s.answers.forEach((p, i) => { n++; if (p === -2) over++; });
      if (s.limit) { ratio += Math.min(1, s.ms / 1000 / s.limit); rn++; }
    });
  }
  return { n, over, avg: rn ? ratio / rn : null };
}

function ltVocBars(m) {
  return `<div class="rp-vbars">${m.prof.map((p) => `<div class="rp-vb${p.tested ? '' : ' un'}"><span class="num">${p.from.toLocaleString()}~${p.to.toLocaleString()}</span><i><b style="width:${Math.round(p.p * 100)}%"></b></i><em class="num">${p.tested ? Math.round(p.p * 100) + '%' : p.p >= 1 ? '앎' : '-'}</em></div>`).join('')}</div>`;
}

function ltRubricBars(m) {
  if (!m.rub) return '';
  return `<div class="rp-rub">${LT_RUBRIC.map((k) => `<div class="rp-rb"><span>${k.name}</span><i>${[1, 2, 3, 4, 5].map((n) => `<b class="${n <= (m.rub[k.key] || 0) ? 'on' : ''}"></b>`).join('')}</i><em class="num">${m.rub[k.key] || '-'}</em></div>`).join('')}</div>`;
}

function ltReport2HTML(a, o) {
  const st = a.student;
  const ov = a.overall || { level: 0, cefr: '-' };
  const comment = o.comment != null ? o.comment : a.comment;
  const ribbon = o.sample ? '<span class="rp-ribbon">예시 리포트, 가상의 학생</span>' : '';
  const mods = a.order.filter((k) => a.mods[k]);
  const ts = ltTimeStats(a);

  const tel = o.phone ? `<a class="rp-tel" href="tel:${o.phone.replace(/[^0-9]/g, '')}">문의 <b>${ltEsc(o.phone)}</b></a>` : '';
  const logo = o.logo ? `<img class="rp-logo" src="${o.logo}" alt="${ltEsc(o.academy)} 로고">` : '';
  const band = `<header class="rp-band">
    <div class="rp-band-top"><span class="rp-acad">${logo}${ltEsc(o.academy)}</span><span class="rp-band-r2">${ribbon}${tel}</span></div>
    <div class="rp-band-main">
      <div class="rp-band-l">
        <h2 class="rp-title">영어 레벨테스트 결과</h2>
        <p class="rp-who"><b>${ltEsc(st.name)}</b><span>${ltEsc(LT_LEVELS[st.grade].name)}</span><span>${mods.map((k) => LT_MODNAME[k]).join(', ')}</span></p>
        <div class="rp-hero">
          <div class="rp-lv"><small>종합 레벨</small><strong>${ov.level <= 0 ? '시작' : LT_LEVELS[ov.level].short}</strong></div>
          <div class="rp-hero-t">
            <p class="rp-hl">${ov.level > 0 ? `${LT_LEVELS[ov.level].name} 수준이에요` : '기초부터 시작해요'}</p>
            <p class="rp-cmp">${ltCmp(ov.level - a.G)}</p>
            <p class="rp-cefr">CEFR <b>${ov.cefr}</b></p>
          </div>
        </div>
      </div>
      <div class="rp-band-r">${ltIdxTiles(a)}<p class="rp-idx-note">렉사일과 AR은 공식 점수가 아니라 책 고를 때 쓰는 참고 범위예요.</p></div>
    </div>
  </header>`;

  const ladder = `<section class="rp-sec">
    <h3>영역별 레벨</h3>
    <div class="rp-ladder">${ltLadderSVG(a, o.print)}</div>
    <p class="rp-legend2"><span><i class="lg-ld"></i>레벨</span><span><i class="lg-grade"></i>지금 학년 (${LT_LEVELS[a.G].short})</span></p>
    <ul class="rp-mods">${mods.map((k) => { const m = a.mods[k]; return `<li><b>${LT_MODNAME[k]}</b><span class="lv">${m.level == null ? '채점 전' : ltLvShort(m.level)}</span><span class="cf">${m.cefr || ''}</span><span class="tx">${ltEsc(ltModLine(k, m, a))}</span></li>`; }).join('')}</ul>
  </section>`;

  const facts = `<section class="rp-sec rp-facts">
    <dl>
      <div><dt>응시일</dt><dd>${ltDate(a.date)}</dd></div>
      <div><dt>푼 문항</dt><dd class="num">${ts.n}개</dd></div>
      <div><dt>시간 초과</dt><dd class="num">${ts.over}개</dd></div>
      <div><dt>시간 쓰기</dt><dd class="num">${ts.avg != null ? `제한의 ${Math.round(ts.avg * 100)}%` : '-'}</dd></div>
    </dl>
    <p class="rp-speed">문항마다 제한 시간이 있어요. ${ts.over ? `시간 안에 못 푼 문항이 ${ts.over}개 있었어요.` : '모든 문항을 시간 안에 풀었어요.'} ${a.mods.read && a.mods.read.speed ? ltEsc(ltSpeedText(a.mods.read)) : ''}</p>
  </section>`;

  const parts = [];
  if (a.mods.read) {
    const r = a.mods.read;
    parts.push(`<section class="rp-sec rp-mod"><h3>리딩 <span>${ltLvShort(r.level)}, ${r.cefr}${r.fk != null ? `, 읽은 글 수준 미국 ${Math.max(1, Math.round(r.fk))}학년` : ''}</span></h3>
      <div class="rp-skills mini">${ltSkillHTML(r)}</div></section>`);
  }
  if (a.mods.voc) {
    const v = a.mods.voc;
    parts.push(`<section class="rp-sec rp-mod"><h3>어휘 <span>${ltLvShort(v.level)}, 약 ${v.size.toLocaleString()}개</span></h3>
      <p class="rp-sub">자주 쓰는 순서대로 묶은 낱말 구간마다 아는 비율이에요. 교육과정 기준은 초등 600, 중학교 1,500, 고1 공통영어 1,800, 영어Ⅱ 2,500개예요.</p>${ltVocBars(v)}</section>`);
  }
  if (a.mods.gram) {
    const g = a.mods.gram;
    parts.push(`<section class="rp-sec rp-mod"><h3>문법 <span>${ltLvShort(g.level)}, ${g.cefr}</span></h3>
      <div class="rp-pts"><div><em>아는 문법</em>${g.known.map((p) => `<span class="pt ok">${ltEsc(p)}</span>`).join('') || '<span class="pt">-</span>'}</div>
      <div><em>다질 문법</em>${g.weak.map((p) => `<span class="pt no">${ltEsc(p)}</span>`).join('') || '<span class="pt">없음</span>'}</div></div></section>`);
  }
  if (a.mods.listen) {
    const l = a.mods.listen;
    parts.push(`<section class="rp-sec rp-mod"><h3>듣기 <span>${ltLvShort(l.level)}, ${l.cefr}</span></h3>
      <div class="rp-pts"><div><em>잘 들은 것</em>${l.known.map((p) => `<span class="pt ok">${ltEsc(p)}</span>`).join('') || '<span class="pt">-</span>'}</div>
      <div><em>놓친 것</em>${l.weak.map((p) => `<span class="pt no">${ltEsc(p)}</span>`).join('') || '<span class="pt">없음</span>'}</div></div></section>`);
  }
  if (a.mods.write) {
    const w = a.mods.write;
    parts.push(`<section class="rp-sec rp-mod"><h3>라이팅 <span>${w.level != null ? `${ltLvShort(w.level)}, ${w.cefr}` : '채점 전'}, ${ltEsc(w.tierName)}</span></h3>
      ${ltRubricBars(w)}
      ${w.errors.length ? `<ul class="rp-fix">${w.errors.slice(0, 3).map((e) => `<li><s>${ltEsc(e.wrong)}</s> → <b>${ltEsc(e.right)}</b> <small>${ltEsc(e.why)}</small></li>`).join('')}</ul>` : ''}
      ${w.summary ? `<p class="rp-wsum">${ltEsc(w.summary)}</p>` : ''}</section>`);
  }

  const books = `<section class="rp-sec">
    <h3>추천 교재와 공부 방향</h3>
    <p class="rp-sub">학원 교재 목록에서 영역마다 레벨에 맞는 교재를 골랐어요. 약한 영역부터 적었어요.</p>
    <ol class="rp-books">${a.plan.map((p) => `<li><div class="bh"><b>${p.name}</b><span class="lv">${ltLvShort(p.level)}</span><span class="bk">${p.book ? ltEsc(p.book) : '맞는 교재 없음'}</span></div><p>${ltEsc(p.text)}</p></li>`).join('')}</ol>
  </section>`;

  const note = `<section class="rp-sec rp-note">
    <h3>선생님 의견</h3>
    <p class="rp-comment">${ltEsc(comment).replace(/\n/g, '<br>')}</p>
    <p class="rp-sign">${ltEsc(o.academy)} 담당 선생님</p>
  </section>`;

  const rows = LT_LEVELS.slice(1).map((L) => `<tr class="${L.lv === ov.level ? 'is-lv' : ''}"><td><b>${L.short}</b>${L.lv === ov.level ? '<em>종합</em>' : ''}${L.lv === a.G ? '<em class="g">학년</em>' : ''}</td><td>${L.stage}</td><td>${LT_SCALE[L.lv].cefr}</td><td class="num">${ltLexText(L.lv)}</td><td class="num">${ltArText(L.lv)}</td><td class="num">${LT_SCALE[L.lv].vocab.toLocaleString()}+</td></tr>`).join('');
  const tableHTML = `<div class="rp-tablewrap"><table class="rp-table t2"><thead><tr><th>단계</th><th>리딩 기준</th><th>CEFR</th><th>렉사일 참고</th><th>AR 참고</th><th>어휘량</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const tableSub = '<p class="rp-sub">우리나라 초1부터 고3까지 12단계예요. 렉사일, AR, 어휘량은 학원 학생 결과와 외부 공식 점수가 쌓이면서 계속 맞춰 가는 참고값이에요.</p>';
  const table = o.print
    ? `<section class="rp-sec"><h3>레벨과 지수는 이렇게 읽어요</h3>${tableSub}${tableHTML}</section>`
    : `<section class="rp-sec"><h3>레벨과 지수는 이렇게 읽어요</h3>${tableSub}<details class="rp-levels"><summary>12단계 기준 모두 보기</summary>${tableHTML}</details></section>`;

  const foot = `<footer class="rp-foot">
    <p>다음 레벨테스트는 <b>${ltAddMonths(a.date, 3)}</b>쯤 보시길 권해요.</p>
    <p>이 결과는 학교 교과서, 모의고사, 수능 수준을 기준으로 ${ltEsc(o.academy)}가 만든 자체 평가예요. 짧은 시험이라 그날 컨디션에 따라 한 단계쯤 달라질 수 있어서, 수업하면서 함께 확인해 드릴게요.</p>
    <p>Lexile®은 MetaMetrics, Inc.의 등록상표이고, AR(Accelerated Reader)과 ATOS는 Renaissance Learning의 상표예요. 이 리포트의 렉사일과 AR 범위는 공식 점수가 아니라 책을 고를 때 쓰는 참고 범위예요.</p>
    <p>학생 정보와 결과는 학원 강의실에만 보관해요. 등록하지 않으면 6개월 뒤 지워요.</p>
    ${o.phone ? `<p>궁금하신 점은 <b>${ltEsc(o.academy)}(${ltEsc(o.phone)})</b>로 연락 주세요.</p>` : ''}
  </footer>`;

  if (!o.print) return `<article class="rp v2">${band}${ladder}${facts}${parts.join('')}${books}${note}${table}${foot}</article>`;
  const mini = () => `<div class="rp-mini"><span class="rp-mini-l">${o.logo ? `<img src="${o.logo}" alt="">` : ''}${ltEsc(o.academy)} 영어 레벨테스트</span><span>${ltEsc(st.name)}, ${ltDate(a.date)}</span></div>`;
  // 워터마크: A4 정중앙, 한 변이 A4 세로의 절반(148.5mm)인 정사각형, 기울이지 않고 흐리게
  const wm = o.watermark || o.logo;
  const water = wm ? `<div class="rp-water" aria-hidden="true"><img src="${wm}" alt=""></div>` : '';
  return `<article class="rp v2 print">
    <div class="rp-sheet s1">${band}<div class="rp-body">${ladder}${facts}${note}</div><div class="rp-pno">1 / 3</div>${water}</div>
    <div class="rp-sheet s2">${mini()}<div class="rp-body">${parts.join('')}</div><div class="rp-pno">2 / 3</div>${water}</div>
    <div class="rp-sheet s3">${mini()}<div class="rp-body">${books}${table}${foot}</div><div class="rp-pno">3 / 3</div>${water}</div>
  </article>`;
}

export {
  LT_LEVELS,
  LT_SKILLS,
  LT_SKILL_ORDER,
  LT_BANK,
  LT_VBANDS,
  LT_GBANK,
  LT_LBANK,
  LT_WBANK,
  LT_RUBRIC,
  LT_SCALE,
  LT_BOOKS_DEFAULT,
  LT_MODS,
  LT_MOD_ORDER,
  LT_MODNAME,
  LT_YEARS,
  LT_GRADES,
  LT_WEIGHT,
  ltBlock,
  ltVocStart,
  ltModStart,
  ltModNext,
  ltScoreBlock,
  ltAnalyzeVoc,
  ltAnalyzeLevel,
  ltAnalyzeWrite,
  ltAnalyzeAll,
  ltOverall,
  ltWriteTier,
  ltStartLevel,
  ltClamp,
  ltReport2HTML,
  ltLvShort,
  ltLexText,
  ltArText,
  ltCefr,
  ltNorm,
  ltEsc,
  ltDate,
  ltComment2,
  ltPlan2,
  ltGiven,
  ltWords,
  ltPathSVG,
  ltSkillHTML,
  ltVocBars,
  ltLadderSVG,
  ltIdxTiles,
  ltModLine,
  ltTimeStats,
  ltCmp,
  ltReadLimits,
  ltFK,
  ltClock,
  ltWordCount,
  ltCondCheck,
  ltRubricBars,
  ltAnd,
  ltJ,
  LT_WSAMPLE_SCORE,
};
