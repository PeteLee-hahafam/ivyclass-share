// 판서 스타일 화면에서 미리 보여 줄 짧은 예시
export const DEMO_SCRIPT = {
  title: '판서 스타일 미리보기',
  sentences: [
    {
      n: 1,
      en: 'Bears, cougars, and other wild animals sometimes remind us of their formidable presence.',
      ko: '곰, 퓨마, 그리고 다른 야생 동물들은 때때로 우리에게 그들의 가공할 만한 존재감을 상기시킨다.',
      marks: [
        { id: 'a1', type: 'under', text: 'Bears, cougars, and other wild animals', label: 'S' },
        { id: 'a2', type: 'under', text: 'remind', label: 'V', note: 'remind A of B' },
        { id: 'a3', type: 'under', text: 'us', label: 'O' },
        { id: 'a4', type: 'box', text: 'of their formidable presence', label: '전치사구' },
        { id: 'a5', type: 'note', text: 'formidable', note: '=fearsome' },
        { id: 'a6', type: 'box', on: 'ko', text: '가공할 만한', color: 'red' },
      ],
    },
    {
      n: 2,
      en: 'In Oregon\'s forests in 1995, a man was found dead, initially blamed on a cougar, but subsequent investigation revealed otherwise.',
      ko: '1995년 오리건주의 숲에서 한 남자가 죽은 채로 발견되었는데, 처음에는 퓨마의 탓으로 여겨졌지만 이후의 조사는 그렇지 않다는 것을 밝혀냈다.',
      marks: [
        { id: 'b1', type: 'box', text: "In Oregon's forests in 1995", label: '문두 부사구' },
        { id: 'b2', type: 'under', text: 'a man', label: 'S' },
        { id: 'b3', type: 'under', text: 'was found', label: 'V', note: '수동태' },
        { id: 'b4', type: 'under', text: 'dead', label: 'C', note: 'died ✕' },
        { id: 'b5', type: 'box', text: 'initially blamed on a cougar', label: '분사구문', note: 'blame A on B' },
        { id: 'b6', type: 'triangle', text: 'but' },
        { id: 'b7', type: 'under', text: 'subsequent investigation', label: 'S' },
        { id: 'b8', type: 'under', text: 'revealed', label: 'V' },
        { id: 'b9', type: 'under', text: 'otherwise', label: 'O' },
      ],
    },
    {
      n: 3,
      en: 'However, upon closer investigation, it became apparent that the wolves were innocent bystanders.',
      ko: '하지만 더 면밀히 조사하자, 늑대들은 무고한 구경꾼이었다는 것이 분명해졌다.',
      marks: [
        { id: 'c1', type: 'box', text: 'However' },
        { id: 'c2', type: 'box', text: 'upon closer investigation', label: '문두 부사구' },
        { id: 'c3', type: 'under', text: 'it', label: '가S' },
        { id: 'c4', type: 'under', text: 'became', label: 'V' },
        { id: 'c4b', type: 'under', text: 'apparent', label: 'C' },
        { id: 'c5', type: 'box', text: 'that the wolves were innocent bystanders', label: '진S (명사절)' },
        { id: 'c6', type: 'hl', text: 'innocent bystanders' },
      ],
    },
    {
      n: 4,
      en: 'The real cause of the attack was a hungry bear looking for food.',
      ko: '그 공격의 진짜 원인은 먹이를 찾던 굶주린 곰이었다.',
      marks: [
        { id: 'd1', type: 'under', text: 'The real cause of the attack', label: 'S' },
        { id: 'd2', type: 'under', text: 'was', label: 'V' },
        { id: 'd3', type: 'under', text: 'a hungry bear looking for food', label: 'C', note: '보어가 길면 괄호' },
      ],
    },
  ],
  memo: [{ id: 'm1', text: '어법 포인트: was found dead (died ✕), became apparent (2형식은 동사와 보어를 함께)' }],
  summary: [{ id: 's1', k: '주제', v: '야생 비극에 숨은 복잡성' }],
  vocab: [
    { id: 'v1', en: 'formidable', ko: '가공할 만한', syn: ['fearsome'], ant: ['harmless'] },
    { id: 'v2', en: 'bystander', ko: '구경꾼', syn: ['onlooker'] },
  ],
  exam: [
    { id: 'e1', k: '어법', text: 'was found dead: 보어 자리라 died로 바꾸면 틀림', n: '2' },
    { id: 'e2', k: '어휘', text: 'formidable을 harmless로 바꾼 틀린 낱말', n: '1' },
  ],
  steps: [
    { view: 'sentence', n: 1, say: '첫 문장 예시예요.' },
    { view: 'sentence', n: 2, say: '두 번째 문장 예시예요.' },
    { view: 'sentence', n: 3, say: '세 번째 문장 예시예요.' },
    { view: 'sentence', n: 4, say: '네 번째 문장 예시예요.' },
    { view: 'memo', say: '메모 예시예요.' },
  ],
};
