const pptxgen = require("pptxgenjs");
const path = require("path");

const outDir = "/Users/baojiale/Documents/英语趣味学习/outputs/ppt-homework-nike-v2";
const hero = path.join(outDir, "assets/style-preview-research-board.png");
const pptxPath = path.join(outDir, "综合影像调研报告_研究看板风_Nike_You_Cant_Stop_Us.pptx");

const pptx = new pptxgen();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Codex";
pptx.subject = "综合影像实践小作业1";
pptx.title = "Nike《You Can't Stop Us》综合影像调研报告";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "PingFang SC",
  bodyFontFace: "PingFang SC",
  lang: "zh-CN",
};

const W = 13.333;
const H = 7.5;
const C = {
  paper: "F5F0E6",
  cream: "FFFDF7",
  ink: "151515",
  sub: "5F625F",
  red: "A92821",
  blue: "174B84",
  paleBlue: "DFEAF5",
  paleRed: "F1DEDA",
  line: "D7CFC0",
  grid: "E6DED0",
  white: "FFFFFF",
  gold: "C79B2B",
};

function bg(slide) {
  slide.background = { color: C.paper };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.paper }, line: { color: C.paper } });
  for (let x = 0.5; x < W; x += 0.5) {
    slide.addShape(pptx.ShapeType.line, { x, y: 0.45, w: 0, h: 6.55, line: { color: C.grid, transparency: 62, width: 0.4 } });
  }
  for (let y = 0.5; y < H; y += 0.5) {
    slide.addShape(pptx.ShapeType.line, { x: 0.45, y, w: 12.45, h: 0, line: { color: C.grid, transparency: 66, width: 0.4 } });
  }
}

function header(slide, no, section, title) {
  slide.addText(`0${no}`, { x: 0.62, y: 0.36, w: 0.52, h: 0.25, fontFace: "Aptos Display", fontSize: 12, bold: true, color: C.red, margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 1.18, y: 0.50, w: 1.35, h: 0, line: { color: C.red, width: 2 } });
  slide.addText(section, { x: 2.65, y: 0.39, w: 3.1, h: 0.22, fontSize: 8.5, bold: true, color: C.sub, charSpace: 1.1, margin: 0 });
  slide.addText(title, { x: 0.62, y: 0.82, w: 9.9, h: 0.48, fontSize: 22, bold: true, color: C.ink, fit: "shrink", margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 0.62, y: 1.42, w: 12.05, h: 0, line: { color: C.line, width: 1 } });
}

function footer(slide, no) {
  slide.addText(`综合影像实践调研报告 · Nike《You Can't Stop Us》 · ${String(no).padStart(2, "0")}`, {
    x: 0.62, y: 7.13, w: 5.7, h: 0.18, fontSize: 7.2, color: C.sub, margin: 0,
  });
  slide.addShape(pptx.ShapeType.line, { x: 11.05, y: 7.22, w: 1.65, h: 0, line: { color: C.ink, width: 1.1 } });
}

function card(slide, x, y, w, h, title, body, accent = C.red) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.cream }, line: { color: C.line, width: 0.9 } });
  slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h, fill: { color: accent }, line: { color: accent } });
  slide.addText(title, { x: x + 0.22, y: y + 0.20, w: w - 0.42, h: 0.24, fontSize: 12.2, bold: true, color: C.ink, margin: 0 });
  slide.addText(body, {
    x: x + 0.22, y: y + 0.58, w: w - 0.42, h: h - 0.75,
    fontSize: 9.3, color: C.sub, breakLine: false, fit: "shrink", margin: 0.01,
  });
}

function bulletList(slide, items, x, y, w, accent = C.red) {
  items.forEach((item, i) => {
    const yy = y + i * 0.62;
    slide.addShape(pptx.ShapeType.rect, { x, y: yy + 0.07, w: 0.08, h: 0.08, fill: { color: accent }, line: { color: accent } });
    slide.addText(item, { x: x + 0.25, y: yy, w, h: 0.36, fontSize: 10.8, color: C.ink, fit: "shrink", margin: 0 });
  });
}

function frame(slide, x, y, w, h, fill = "F8F5ED") {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { color: C.line, width: 1 } });
}

function splitDiagram(slide, x, y, w, h) {
  frame(slide, x, y, w, h, "F2EEE5");
  slide.addShape(pptx.ShapeType.rect, { x: x + 0.12, y: y + 0.12, w: w / 2 - 0.14, h: h - 0.24, fill: { color: "DAD7D0" }, line: { color: "DAD7D0" } });
  slide.addShape(pptx.ShapeType.rect, { x: x + w / 2, y: y + 0.12, w: w / 2 - 0.12, h: h - 0.24, fill: { color: "252525" }, line: { color: "252525" } });
  slide.addShape(pptx.ShapeType.rect, { x: x + w * 0.19, y: y + 0.12, w: 0.82, h: h - 0.24, fill: { color: C.red, transparency: 18 }, line: { color: C.red, transparency: 100 } });
  slide.addShape(pptx.ShapeType.rect, { x: x + w * 0.78, y: y + 0.12, w: 0.32, h: h - 0.24, fill: { color: C.blue, transparency: 8 }, line: { color: C.blue, transparency: 100 } });
  slide.addShape(pptx.ShapeType.line, { x: x + w / 2, y: y + 0.12, w: 0, h: h - 0.24, line: { color: "FFFFFF", width: 1.2 } });
  slide.addShape(pptx.ShapeType.arc, { x: x + 0.8, y: y + 1.0, w: 2.8, h: 1.8, line: { color: C.red, width: 1.2, dash: "dash" }, fill: { color: "FFFFFF", transparency: 100 } });
  slide.addShape(pptx.ShapeType.line, { x: x + 2.3, y: y + 2.4, w: 3.1, h: -1.1, line: { color: C.ink, width: 0.8, dash: "dash" } });
  slide.addShape(pptx.ShapeType.ellipse, { x: x + 2.25, y: y + 2.35, w: 0.08, h: 0.08, fill: { color: C.ink }, line: { color: C.ink } });
  slide.addShape(pptx.ShapeType.ellipse, { x: x + 5.34, y: y + 1.24, w: 0.08, h: 0.08, fill: { color: C.ink }, line: { color: C.ink } });
  slide.addText("split line", { x: x + w / 2 - 0.35, y: y + h - 0.34, w: 0.7, h: 0.14, fontFace: "Aptos", fontSize: 6.4, color: C.sub, align: "center", margin: 0 });
}

function filmStrip(slide, x, y, w, h, n = 8) {
  frame(slide, x, y, w, h, "EFE8DC");
  const gap = 0.05;
  const cell = (w - 0.25 - (n - 1) * gap) / n;
  for (let i = 0; i < n; i++) {
    const cx = x + 0.12 + i * (cell + gap);
    slide.addShape(pptx.ShapeType.rect, { x: cx, y: y + 0.12, w: cell, h: h - 0.24, fill: { color: i % 2 ? "C8C5BD" : "DCD8CF" }, line: { color: "F8F5ED", width: 0.4 } });
    slide.addShape(pptx.ShapeType.line, { x: cx + cell * 0.15, y: y + h - 0.18, w: cell * 0.55, h: -h * 0.45, line: { color: i % 3 ? C.red : C.blue, width: 0.7, transparency: 20 } });
  }
}

function label(slide, text, x, y, color = C.red) {
  slide.addShape(pptx.ShapeType.rect, { x, y: y + 0.09, w: 0.38, h: 0.04, fill: { color }, line: { color } });
  slide.addText(text, { x: x + 0.48, y, w: 2.7, h: 0.22, fontSize: 8.8, bold: true, color: C.sub, charSpace: 0.8, margin: 0 });
}

const slides = [
  {
    section: "RESEARCH OBJECT",
    title: "作业要求与选题说明",
    cards: [
      ["作业任务", "选择 1 部具有代表性的“综合影像”作品，完成图文并茂的调研报告。"],
      ["本报告选题", "Nike 广告短片《You Can't Stop Us》，发布于 2020 年。"],
      ["选择理由", "作品融合广告、体育影像、素材拼贴、分屏剪辑与社会情绪表达。"],
      ["报告结构", "从基本信息、创作背景、技术手法、影像语言与审美特点四部分展开。"],
    ],
  },
  {
    section: "PART 01 · BASIC INFO",
    title: "作品基本信息",
    facts: [
      ["作品名称", "You Can't Stop Us"],
      ["作品类型", "广告短片 / 体育影像 / 分屏蒙太奇"],
      ["发布年份", "2020 年"],
      ["品牌", "Nike"],
      ["创意代理", "Wieden+Kennedy Portland"],
      ["旁白", "Megan Rapinoe"],
    ],
  },
  {
    section: "CONTENT OVERVIEW",
    title: "作品内容概述",
    bullets: [
      "短片把不同运动员、不同项目、不同场景的影像片段重新拼接。",
      "左右两半画面经常来自不同素材，却在动作、姿态、构图上形成连接。",
      "作品传达“困难不能阻止运动与人的连接”的体育精神。",
      "它讲述的不是一个人的故事，而是群体共同面对困境的故事。",
    ],
  },
  {
    section: "PART 02 · BACKGROUND",
    title: "创作背景：疫情语境中的体育停摆",
    bullets: [
      "2020 年全球公共卫生危机影响体育赛事、训练与日常生活。",
      "许多线下比赛暂停，人与人之间的连接感被削弱。",
      "Nike 在此背景下推出短片，用体育影像回应共同的不确定情绪。",
      "作品把体育精神与社会团结联系起来，形成更广泛的公共表达。",
    ],
  },
  {
    section: "COMMUNICATION PURPOSE",
    title: "创作目的：从商业广告到情感动员",
    cards: [
      ["表达核心", "体育不会因为困难而停止，人的连接也不会被完全切断。"],
      ["品牌精神", "强化 Nike 一贯强调的坚持、突破、团结与行动。"],
      ["情绪共鸣", "用真实运动影像唤起观众对赛事、身体与共同体的记忆。"],
      ["传播策略", "减少直接商品呈现，把品牌放进更大的社会情绪叙事中。"],
    ],
  },
  {
    section: "PART 03 · TECHNIQUE",
    title: "技术手法一：分屏剪辑",
    bullets: [
      "作品最突出的形式是左右分屏，将两个不同镜头拼成一个连续动作。",
      "剪辑依据包括身体姿态、运动方向、画面重心和动作速度。",
      "中线既是视觉缝合线，也是作品主题的隐喻：分离中仍然连接。",
      "这种分屏不是装饰，而是把技术形式变成意义表达。",
    ],
  },
  {
    section: "MATERIAL MATCHING",
    title: "技术手法二：素材拼贴与匹配剪辑",
    bullets: [
      "作品使用大量不同来源的体育素材，包含不同项目、人物和场景。",
      "剪辑重点不是简单堆砌，而是寻找动作之间的相似性与连续性。",
      "素材重组后，单个比赛片段被转化为更大的集体叙事。",
      "不同影像之间的差异被保留，使作品同时具有多样性与统一感。",
    ],
  },
  {
    section: "SOUND & RHYTHM",
    title: "技术手法三：声音、旁白与节奏",
    bullets: [
      "Megan Rapinoe 的旁白推动短片从困境叙述转向希望表达。",
      "音乐和剪辑节奏逐步加快，情绪从低沉转为振奋。",
      "旁白不是简单解释画面，而是把体育动作提升为社会情绪。",
      "声音、动作和剪辑点共同构成作品的情绪曲线。",
    ],
  },
  {
    section: "PART 04 · IMAGE LANGUAGE",
    title: "影像语言分析",
    cards: [
      ["对称", "左右画面形成镜像关系，使不同场景看起来属于同一视觉空间。"],
      ["并置", "不同人物、项目、国家和场景同时出现，形成跨边界的比较。"],
      ["连续", "动作轨迹被剪成流畅的身体线条，强化运动的流动感。"],
      ["象征", "体育动作被转化为“不停止”的精神象征，而不只是比赛记录。"],
    ],
  },
  {
    section: "AESTHETIC VALUE",
    title: "审美特点与作品价值",
    bullets: [
      "视觉上具有强烈的设计感，分屏结构带来秩序和形式美。",
      "真实体育素材保留纪实质感，让情绪表达更可信。",
      "作品的情绪表达克制但有力量，没有依赖过度煽情的画面。",
      "它把商业广告提升为具有公共情绪与审美表达的综合影像作品。",
    ],
  },
  {
    section: "SUMMARY",
    title: "总结与个人评价",
    bullets: [
      "《You Can't Stop Us》是一部典型的综合影像作品。",
      "它综合了广告、体育、纪录素材、剪辑技术和公共议题。",
      "最大亮点是让“分屏形式”服务于“团结主题”。",
      "对综合影像实践的启发：技术不能只是炫技，而要服务主题和情感表达。",
    ],
  },
];

// Slide 1 cover
{
  const s = pptx.addSlide();
  s.addImage({ path: hero, x: 0, y: 0, w: W, h: H });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: "F5F0E6", transparency: 18 }, line: { color: "F5F0E6", transparency: 100 } });
  s.addShape(pptx.ShapeType.rect, { x: 0.72, y: 0.72, w: 4.85, h: 5.9, fill: { color: C.cream, transparency: 3 }, line: { color: C.line, width: 1 } });
  label(s, "综合影像实践 · 小作业1", 1.02, 1.08, C.red);
  s.addText("Nike", { x: 1.02, y: 1.58, w: 1.9, h: 0.48, fontFace: "Aptos Display", fontSize: 25, bold: true, color: C.ink, margin: 0 });
  s.addText("You Can't Stop Us", { x: 1.02, y: 2.10, w: 4.0, h: 0.42, fontFace: "Aptos Display", fontSize: 20, bold: true, color: C.ink, fit: "shrink", margin: 0 });
  s.addText("综合影像作品调研报告", { x: 1.02, y: 2.78, w: 3.8, h: 0.44, fontSize: 18, bold: true, color: C.ink, margin: 0 });
  s.addShape(pptx.ShapeType.line, { x: 1.02, y: 3.46, w: 3.95, h: 0, line: { color: C.ink, width: 1.2 } });
  s.addText("分屏剪辑中的体育精神与公共情绪表达", { x: 1.02, y: 3.75, w: 3.8, h: 0.45, fontSize: 13.5, color: C.sub, fit: "shrink", margin: 0 });
  s.addText("报告聚焦作品的基本信息、创作背景、技术手法与影像语言，分析它如何把大量异质素材组织成有审美秩序的综合影像。", {
    x: 1.02, y: 4.55, w: 3.85, h: 0.95, fontSize: 10.6, color: C.ink, breakLine: false, fit: "shrink", margin: 0,
  });
  s.addText("12-page research deck", { x: 1.02, y: 6.07, w: 2.2, h: 0.18, fontFace: "Aptos", fontSize: 7.5, color: C.sub, margin: 0 });
}

slides.forEach((d, idx) => {
  const no = idx + 2;
  const s = pptx.addSlide();
  bg(s);
  header(s, no, d.section, d.title);
  if (idx === 0) {
    s.addImage({ path: hero, x: 0.72, y: 1.78, w: 5.2, h: 2.93 });
    label(s, "REPORT STRUCTURE", 6.28, 1.78, C.blue);
    d.cards.forEach((c, i) => card(s, 6.28 + (i % 2) * 3.0, 2.22 + Math.floor(i / 2) * 1.55, 2.65, 1.18, c[0], c[1], i % 2 ? C.blue : C.red));
    filmStrip(s, 0.72, 5.28, 11.9, 0.82, 10);
  } else if (d.facts) {
    splitDiagram(s, 0.72, 1.82, 5.25, 3.5);
    d.facts.forEach((f, i) => {
      const y = 1.82 + i * 0.65;
      slide = s;
      s.addText(f[0], { x: 6.38, y, w: 1.4, h: 0.24, fontSize: 10, bold: true, color: i % 2 ? C.blue : C.red, margin: 0 });
      s.addText(f[1], { x: 7.92, y: y - 0.02, w: 3.95, h: 0.3, fontSize: 11.2, color: C.ink, fit: "shrink", margin: 0 });
      s.addShape(pptx.ShapeType.line, { x: 6.38, y: y + 0.38, w: 5.4, h: 0, line: { color: C.line, width: 0.8 } });
    });
    filmStrip(s, 1.12, 5.92, 10.85, 0.55, 12);
  } else if (d.cards) {
    splitDiagram(s, 0.72, 1.82, 4.85, 3.25);
    d.cards.forEach((c, i) => card(s, 6.02 + (i % 2) * 3.05, 1.82 + Math.floor(i / 2) * 1.62, 2.72, 1.26, c[0], c[1], i % 2 ? C.blue : C.red));
    filmStrip(s, 0.72, 5.72, 11.9, 0.62, 11);
  } else if (idx === 5) {
    splitDiagram(s, 0.72, 1.82, 6.1, 3.75);
    bulletList(s, d.bullets, 7.35, 1.92, 4.7, C.red);
    label(s, "MATCHING LOGIC", 0.9, 5.88, C.blue);
    s.addText("身体姿态 / 运动方向 / 画面重心 / 动作速度", { x: 2.58, y: 5.87, w: 5.8, h: 0.2, fontSize: 9.4, color: C.sub, margin: 0 });
  } else {
    splitDiagram(s, 7.35, 1.88, 4.85, 3.08);
    bulletList(s, d.bullets, 0.95, 1.95, 5.75, idx % 2 ? C.blue : C.red);
    if (idx === 2 || idx === 3 || idx === 6 || idx === 7 || idx === 9 || idx === 10) {
      const callout = [
        "核心观点：不同素材通过剪辑关系被重新组织，形成新的叙事。",
        "背景意义：作品回应的是共同的社会情绪，而不只是体育比赛。",
        "技术关键：匹配剪辑让素材之间产生连续性和因果感。",
        "节奏作用：声音让画面从运动记录上升到价值表达。",
        "审美价值：纪实素材与设计结构之间形成张力。",
        "个人评价：技术最终要服务主题、情感与审美秩序。",
      ][[2,3,6,7,9,10].indexOf(idx)];
      card(s, 0.95, 5.55, 5.8, 0.72, "分析结论", callout, idx % 2 ? C.blue : C.red);
    }
  }
  footer(s, no);
});

// References line added to last slide
{
  const s = pptx._slides[pptx._slides.length - 1];
  label(s, "REFERENCES", 7.35, 5.55, C.blue);
  s.addText("Wieden+Kennedy 项目页；Colossal / Digital Synopsis / Musicbed 制作分析文章；课堂作业照片。", {
    x: 7.35, y: 5.92, w: 4.85, h: 0.45, fontSize: 9.1, color: C.sub, fit: "shrink", margin: 0,
  });
}

pptx.writeFile({ fileName: pptxPath });
