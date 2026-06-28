const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const outDir = "/Users/baojiale/Documents/英语趣味学习/outputs/ppt-homework-nike";
const assignmentImage = "/Users/baojiale/Downloads/1263.JPG";
const pptxPath = path.join(outDir, "综合影像调研报告_Nike_You_Cant_Stop_Us.pptx");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Codex";
pptx.company = "英语趣味学习";
pptx.subject = "综合影像实践小作业1";
pptx.title = "Nike《You Can't Stop Us》综合影像调研报告";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "PingFang SC",
  bodyFontFace: "PingFang SC",
  lang: "zh-CN",
};
pptx.defineLayout({ name: "CUSTOM_WIDE", width: 13.333, height: 7.5 });
pptx.layout = "CUSTOM_WIDE";

const W = 13.333;
const H = 7.5;
const C = {
  ink: "111111",
  paper: "F7F4EF",
  white: "FFFFFF",
  red: "E93D35",
  blue: "1C7ED6",
  cyan: "4DD0E1",
  yellow: "F7C948",
  green: "2F9E44",
  gray: "6B7280",
  light: "EDE8DF",
  dark: "1F2937",
};

function addBg(slide, color = C.paper) {
  slide.background = { color };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color }, line: { color } });
}

function addHeader(slide, kicker, title, options = {}) {
  const dark = options.dark || false;
  const tc = dark ? C.white : C.ink;
  const kc = dark ? C.cyan : C.red;
  slide.addText(kicker, {
    x: 0.65, y: 0.38, w: 3.3, h: 0.25,
    fontFace: "PingFang SC", fontSize: 8.5, bold: true,
    color: kc, charSpace: 1.2, margin: 0,
  });
  slide.addText(title, {
    x: 0.65, y: 0.72, w: 10.8, h: 0.55,
    fontFace: "PingFang SC", fontSize: 25, bold: true,
    color: tc, breakLine: false, fit: "shrink",
    margin: 0,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.65, y: 1.36, w: 12.0, h: 0,
    line: { color: dark ? "FFFFFF" : "D7D0C5", transparency: dark ? 70 : 0, width: 1 },
  });
}

function addFooter(slide, idx, dark = false) {
  slide.addText(`综合影像实践 · 调研报告  |  ${String(idx).padStart(2, "0")}`, {
    x: 0.65, y: 7.08, w: 4.2, h: 0.18,
    fontSize: 7.5, color: dark ? "D1D5DB" : C.gray, margin: 0,
  });
}

function addPill(slide, text, x, y, w, color, textColor = C.white) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: 0.38,
    rectRadius: 0.06,
    fill: { color },
    line: { color, transparency: 100 },
  });
  slide.addText(text, { x, y: y + 0.095, w, h: 0.16, fontSize: 8, bold: true, color: textColor, align: "center", margin: 0 });
}

function addCard(slide, x, y, w, h, title, body, accent = C.red) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.08,
    fill: { color: C.white, transparency: 0 },
    line: { color: "E4DED3", width: 1 },
    shadow: { type: "outer", color: "000000", opacity: 0.08, blur: 1, angle: 45, distance: 1 },
  });
  slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h, fill: { color: accent }, line: { color: accent } });
  slide.addText(title, { x: x + 0.25, y: y + 0.22, w: w - 0.45, h: 0.27, fontSize: 13, bold: true, color: C.ink, margin: 0 });
  slide.addText(body, { x: x + 0.25, y: y + 0.66, w: w - 0.45, h: h - 0.85, fontSize: 9.4, color: C.dark, breakLine: false, fit: "shrink", valign: "top", margin: 0.02, bullet: { type: "ul" } });
}

function splitScene(slide, x, y, w, h, opts = {}) {
  const left = opts.left || C.red;
  const right = opts.right || C.blue;
  slide.addShape(pptx.ShapeType.rect, { x, y, w: w / 2, h, fill: { color: left }, line: { color: left } });
  slide.addShape(pptx.ShapeType.rect, { x: x + w / 2, y, w: w / 2, h, fill: { color: right }, line: { color: right } });
  slide.addShape(pptx.ShapeType.line, { x: x + w / 2, y, w: 0, h, line: { color: C.white, width: 2.2, transparency: 8 } });
  // Abstract bodies aligned across the split.
  const cy = y + h * 0.50;
  slide.addShape(pptx.ShapeType.arc, { x: x + w * 0.15, y: cy - h * 0.22, w: w * 0.32, h: h * 0.5, adjustPoint: 0.45, line: { color: C.white, width: 4, transparency: 4 }, fill: { color: left, transparency: 100 } });
  slide.addShape(pptx.ShapeType.arc, { x: x + w * 0.53, y: cy - h * 0.26, w: w * 0.30, h: h * 0.52, adjustPoint: 0.45, line: { color: C.white, width: 4, transparency: 4 }, fill: { color: right, transparency: 100 } });
  slide.addShape(pptx.ShapeType.ellipse, { x: x + w * 0.40, y: y + h * 0.22, w: 0.28, h: 0.28, fill: { color: C.white }, line: { color: C.white } });
  slide.addShape(pptx.ShapeType.ellipse, { x: x + w * 0.53, y: y + h * 0.19, w: 0.28, h: 0.28, fill: { color: C.white }, line: { color: C.white } });
  for (let i = 0; i < 8; i++) {
    slide.addShape(pptx.ShapeType.line, {
      x: x + 0.25 + i * (w - 0.5) / 7, y: y + h - 0.36 - (i % 2) * 0.08, w: 0.35, h: 0,
      line: { color: C.white, width: 1, transparency: 40 },
    });
  }
}

function sectionLabel(slide, n, label, x, y, c = C.red) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w: 0.52, h: 0.52, fill: { color: c }, line: { color: c } });
  slide.addText(String(n), { x, y: y + 0.13, w: 0.52, h: 0.15, fontSize: 11, bold: true, color: C.white, align: "center", margin: 0 });
  slide.addText(label, { x: x + 0.7, y: y + 0.10, w: 3.6, h: 0.23, fontSize: 12, bold: true, color: C.ink, margin: 0 });
}

// 1 Cover
{
  const s = pptx.addSlide();
  addBg(s, C.ink);
  splitScene(s, 6.7, 0, 6.633, 7.5, { left: C.red, right: C.blue });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 6.95, h: 7.5, fill: { color: C.ink, transparency: 0 }, line: { color: C.ink } });
  s.addText("综合影像实践 · 小作业1", { x: 0.65, y: 0.55, w: 3.2, h: 0.25, fontSize: 9, bold: true, color: C.cyan, charSpace: 1.4, margin: 0 });
  s.addText("Nike《You Can’t Stop Us》", { x: 0.65, y: 1.35, w: 5.9, h: 0.8, fontSize: 25, bold: true, color: C.white, fit: "shrink", margin: 0 });
  s.addText("综合影像作品调研报告", { x: 0.65, y: 2.18, w: 5.5, h: 0.5, fontSize: 20, bold: true, color: C.white, transparency: 6, margin: 0 });
  s.addText("从分屏剪辑、素材拼贴与体育精神叙事出发，分析一支广告短片如何把大量异质影像组织成具有情感力量的综合影像。", {
    x: 0.68, y: 3.0, w: 5.2, h: 1.2, fontSize: 12.5, color: "E5E7EB", breakLine: false, fit: "shrink", margin: 0,
  });
  addPill(s, "广告短片", 0.68, 4.55, 1.05, C.red);
  addPill(s, "分屏蒙太奇", 1.88, 4.55, 1.35, C.blue);
  addPill(s, "社会情绪传播", 3.38, 4.55, 1.65, C.yellow, C.ink);
  s.addShape(pptx.ShapeType.line, { x: 0.68, y: 6.66, w: 4.9, h: 0, line: { color: C.white, transparency: 78, width: 1 } });
  s.addText("作品发布：2020 年 7 月  |  调研报告", { x: 0.68, y: 6.86, w: 4.2, h: 0.18, fontSize: 8, color: "CBD5E1", margin: 0 });
}

// 2 Assignment fit
{
  const s = pptx.addSlide();
  addBg(s);
  addHeader(s, "TASK RESPONSE", "作业要求与选题说明");
  if (fs.existsSync(assignmentImage)) {
    s.addImage({ path: assignmentImage, x: 0.65, y: 1.75, w: 4.2, h: 4.75 });
    s.addShape(pptx.ShapeType.rect, { x: 0.65, y: 1.75, w: 4.2, h: 4.75, fill: { color: C.white, transparency: 100 }, line: { color: "D4CEC2", width: 1.2 } });
  }
  s.addText("本报告选择 Nike 2020 年广告短片《You Can’t Stop Us》作为代表性“综合影像”作品。", {
    x: 5.35, y: 1.78, w: 6.9, h: 0.55, fontSize: 17, bold: true, color: C.ink, margin: 0,
  });
  addCard(s, 5.35, 2.65, 2.1, 2.9, "01 基本信息", "片名、类型、年份、品牌、主创与传播场景", C.red);
  addCard(s, 7.65, 2.65, 2.1, 2.9, "02 背景目的", "疫情与体育停摆语境中，重建集体信念与品牌精神", C.blue);
  addCard(s, 9.95, 2.65, 2.1, 2.9, "03 技术手法", "素材检索、动作匹配、分屏拼接、节奏剪辑与声音设计", C.yellow);
  addCard(s, 5.35, 5.82, 6.7, 0.75, "04 影像语言与审美特点", "用“看似不同、实则相连”的视觉结构，表达体育、社会与个体经验之间的共振。", C.green);
  addFooter(s, 2);
}

// 3 Basic information
{
  const s = pptx.addSlide();
  addBg(s);
  addHeader(s, "PART 01", "作品基本信息");
  splitScene(s, 0.65, 1.72, 4.85, 4.05, { left: C.red, right: C.blue });
  s.addText("代表作品", { x: 0.84, y: 6.02, w: 1.2, h: 0.2, fontSize: 9, bold: true, color: C.red, margin: 0 });
  s.addText("Nike《You Can’t Stop Us》", { x: 0.84, y: 6.28, w: 4.3, h: 0.28, fontSize: 14, bold: true, color: C.ink, margin: 0 });
  const rows = [
    ["作品类型", "品牌广告短片 / 体育影像拼贴 / 分屏蒙太奇"],
    ["发布时间", "2020 年 7 月"],
    ["品牌与代理", "Nike；Wieden+Kennedy Portland"],
    ["旁白", "Megan Rapinoe"],
    ["核心形式", "36 组分屏画面，将 72 个运动镜头进行动作与构图匹配"],
    ["传播主题", "You Can’t Stop Us：困境中仍保持连接、行动与希望"],
  ];
  rows.forEach((r, i) => {
    const y = 1.72 + i * 0.72;
    s.addText(r[0], { x: 6.05, y, w: 1.35, h: 0.22, fontSize: 9.5, bold: true, color: C.red, margin: 0 });
    s.addText(r[1], { x: 7.45, y: y - 0.02, w: 4.7, h: 0.34, fontSize: 12, color: C.ink, fit: "shrink", margin: 0 });
    s.addShape(pptx.ShapeType.line, { x: 6.05, y: y + 0.43, w: 5.95, h: 0, line: { color: "DDD6CB", width: 0.8 } });
  });
  addFooter(s, 3);
}

// 4 Representative value
{
  const s = pptx.addSlide();
  addBg(s, "FFFDF8");
  addHeader(s, "WHY THIS WORK", "为什么它具有“综合影像”代表性");
  const items = [
    ["素材来源综合", "作品并非单一拍摄场景，而是把不同赛事、运动项目、国家地区与人物身份的影像重新组织。"],
    ["媒介形态综合", "它既是广告，也是短片、社交媒体传播内容与体育文化叙事，兼具商业传播和公共情绪表达。"],
    ["技术语言综合", "分屏、匹配剪辑、档案素材筛选、声音旁白与音乐节奏共同构成意义。"],
    ["情感主题综合", "从个体动作上升到群体信念，把体育、疫情、平权与共同体经验连接在一起。"],
  ];
  items.forEach((it, i) => {
    const x = 0.72 + (i % 2) * 6.05;
    const y = 1.85 + Math.floor(i / 2) * 2.2;
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.45, h: 1.62, rectRadius: 0.08, fill: { color: i % 2 ? "F0F7FF" : "FFF1F0" }, line: { color: i % 2 ? "BBD7F5" : "F0C6C1" } });
    s.addText(`0${i + 1}`, { x: x + 0.28, y: y + 0.28, w: 0.52, h: 0.24, fontSize: 13, bold: true, color: i % 2 ? C.blue : C.red, margin: 0 });
    s.addText(it[0], { x: x + 0.95, y: y + 0.27, w: 4.0, h: 0.24, fontSize: 14, bold: true, color: C.ink, margin: 0 });
    s.addText(it[1], { x: x + 0.95, y: y + 0.75, w: 4.05, h: 0.62, fontSize: 10.6, color: C.dark, fit: "shrink", margin: 0 });
  });
  s.addText("结论：它把“不同来源的影像”通过新的剪辑逻辑变成“一个共同叙事”，正体现综合影像的跨媒介、跨素材、跨语境特征。", {
    x: 1.05, y: 6.3, w: 11.2, h: 0.38, fontSize: 13, bold: true, color: C.ink, align: "center", margin: 0,
  });
  addFooter(s, 4);
}

// 5 Background and purpose
{
  const s = pptx.addSlide();
  addBg(s);
  addHeader(s, "PART 02", "创作背景与目的");
  sectionLabel(s, 1, "特殊时代语境", 0.75, 1.73, C.red);
  sectionLabel(s, 2, "品牌传播目的", 0.75, 3.26, C.blue);
  sectionLabel(s, 3, "情感动员策略", 0.75, 4.79, C.green);
  s.addText("2020 年，全球公共卫生危机使体育赛事、训练和线下社交被打断。广告选择以大量真实体育片段回应“停摆感”：运动员的身体仍在动作中，观众的情绪也被重新连接。", { x: 3.95, y: 1.67, w: 7.65, h: 0.68, fontSize: 12.2, color: C.dark, fit: "shrink", margin: 0 });
  s.addText("Nike 延续“体育改变世界”的品牌叙事，不直接强调商品，而是把品牌放在“坚持、团结、突破”的价值语境中，提升公共议题中的品牌认同。", { x: 3.95, y: 3.20, w: 7.65, h: 0.68, fontSize: 12.2, color: C.dark, fit: "shrink", margin: 0 });
  s.addText("旁白从个人经验扩展到群体经验：没有谁是孤立的。分屏画面让两个毫不相干的动作在视觉上接续，形成“我们其实在一起”的情感证明。", { x: 3.95, y: 4.73, w: 7.65, h: 0.68, fontSize: 12.2, color: C.dark, fit: "shrink", margin: 0 });
  s.addShape(pptx.ShapeType.chevron, { x: 3.3, y: 2.45, w: 0.35, h: 0.35, fill: { color: "D8D1C5" }, line: { color: "D8D1C5" }, rotate: 90 });
  s.addShape(pptx.ShapeType.chevron, { x: 3.3, y: 3.98, w: 0.35, h: 0.35, fill: { color: "D8D1C5" }, line: { color: "D8D1C5" }, rotate: 90 });
  addFooter(s, 5);
}

// 6 Technical method overview
{
  const s = pptx.addSlide();
  addBg(s, C.ink);
  addHeader(s, "PART 03", "技术手法：从素材库到分屏叙事", { dark: true });
  const steps = [
    ["素材检索", "寻找不同运动、人物与历史片段"],
    ["动作匹配", "按身体姿态、方向、速度进行配对"],
    ["构图拼接", "将左右两半画面接成“一个动作”"],
    ["节奏剪辑", "配合旁白、音乐与情绪递进"],
    ["意义生成", "把多元个体变成共同体叙事"],
  ];
  steps.forEach((st, i) => {
    const x = 0.78 + i * 2.42;
    s.addShape(pptx.ShapeType.roundRect, { x, y: 2.1, w: 1.92, h: 2.35, rectRadius: 0.09, fill: { color: i % 2 ? "243B53" : "2B2B2B" }, line: { color: i % 2 ? C.cyan : C.red, width: 1.2 } });
    s.addText(`0${i + 1}`, { x: x + 0.18, y: 2.34, w: 0.45, h: 0.2, fontSize: 9, bold: true, color: i % 2 ? C.cyan : C.red, margin: 0 });
    s.addText(st[0], { x: x + 0.18, y: 2.78, w: 1.5, h: 0.28, fontSize: 13, bold: true, color: C.white, margin: 0 });
    s.addText(st[1], { x: x + 0.18, y: 3.28, w: 1.48, h: 0.62, fontSize: 9.2, color: "D1D5DB", fit: "shrink", margin: 0 });
    if (i < steps.length - 1) {
      s.addShape(pptx.ShapeType.chevron, { x: x + 2.03, y: 3.18, w: 0.28, h: 0.28, fill: { color: "56616E" }, line: { color: "56616E" } });
    }
  });
  splitScene(s, 3.25, 5.2, 6.8, 1.12, { left: C.red, right: C.blue });
  s.addText("技术关键不是“把两个画面放在一起”，而是让两个画面在身体方向、运动轨迹、画面重心和情绪节奏上形成连续性。", {
    x: 2.2, y: 6.62, w: 8.9, h: 0.28, fontSize: 11, bold: true, color: C.white, align: "center", margin: 0,
  });
  addFooter(s, 6, true);
}

// 7 Split-screen detail
{
  const s = pptx.addSlide();
  addBg(s);
  addHeader(s, "TECHNIQUE FOCUS", "分屏匹配：让差异画面产生同一动作");
  splitScene(s, 0.82, 1.73, 5.5, 4.1, { left: "D94841", right: "1D6FB8" });
  const notes = [
    ["中心线", "左右画面以中线为缝合点，身体动作在中线附近衔接。"],
    ["运动方向", "运动员的冲刺、起跳、转身等动作保持同向或互补。"],
    ["画面重心", "头部、肩部、球体或肢体落在相近位置，降低拼接突兀感。"],
    ["意义转化", "不同性别、项目、国家的影像被剪成同一个节奏，暗示共同处境。"],
  ];
  notes.forEach((n, i) => {
    const y = 1.78 + i * 1.06;
    s.addShape(pptx.ShapeType.rect, { x: 7.05, y, w: 0.16, h: 0.16, fill: { color: i % 2 ? C.blue : C.red }, line: { color: i % 2 ? C.blue : C.red } });
    s.addText(n[0], { x: 7.38, y: y - 0.03, w: 1.2, h: 0.24, fontSize: 12.5, bold: true, color: C.ink, margin: 0 });
    s.addText(n[1], { x: 8.55, y: y - 0.02, w: 3.25, h: 0.34, fontSize: 10.4, color: C.dark, fit: "shrink", margin: 0 });
  });
  s.addShape(pptx.ShapeType.line, { x: 3.57, y: 1.73, w: 0, h: 4.1, line: { color: C.yellow, width: 3 } });
  s.addText("视觉缝合线", { x: 3.05, y: 5.98, w: 1.05, h: 0.18, fontSize: 8.5, bold: true, color: C.red, align: "center", margin: 0 });
  addFooter(s, 7);
}

// 8 Sound and rhythm
{
  const s = pptx.addSlide();
  addBg(s, "F8FBFF");
  addHeader(s, "SOUND & RHYTHM", "声音与节奏：旁白推动意义上升");
  const beats = [
    ["开端", "从困境和限制进入：画面强调停顿、分离与不确定。"],
    ["推进", "镜头匹配越来越密集，运动动作形成连续爆发。"],
    ["高潮", "旁白、音乐与高强度动作叠合，情绪转为团结与希望。"],
    ["收束", "品牌口号回到标题，完成从个人到共同体的价值归纳。"],
  ];
  beats.forEach((b, i) => {
    const x = 1.02 + i * 3.05;
    const h = 0.78 + i * 0.28;
    s.addShape(pptx.ShapeType.rect, { x, y: 4.95 - h, w: 1.92, h, fill: { color: [C.blue, C.cyan, C.yellow, C.red][i] }, line: { color: [C.blue, C.cyan, C.yellow, C.red][i] } });
    s.addText(b[0], { x, y: 5.15, w: 1.92, h: 0.24, fontSize: 13, bold: true, color: C.ink, align: "center", margin: 0 });
    s.addText(b[1], { x: x - 0.28, y: 5.58, w: 2.48, h: 0.48, fontSize: 9.2, color: C.dark, align: "center", fit: "shrink", margin: 0 });
  });
  s.addShape(pptx.ShapeType.line, { x: 0.85, y: 4.95, w: 11.7, h: 0, line: { color: C.ink, width: 1.2 } });
  s.addText("Megan Rapinoe 的旁白不是单纯解释画面，而是不断把“运动行为”提升为“社会情绪”：坚持、平等、连接、共同前进。", {
    x: 1.15, y: 1.92, w: 10.95, h: 0.75, fontSize: 18, bold: true, color: C.ink, align: "center", fit: "shrink", margin: 0,
  });
  addPill(s, "旁白", 2.55, 3.12, 1.0, C.red);
  addPill(s, "音乐", 4.08, 3.12, 1.0, C.blue);
  addPill(s, "剪辑点", 5.6, 3.12, 1.18, C.yellow, C.ink);
  addPill(s, "动作峰值", 7.32, 3.12, 1.32, C.green);
  addFooter(s, 8);
}

// 9 Visual language
{
  const s = pptx.addSlide();
  addBg(s);
  addHeader(s, "PART 04", "影像语言分析");
  const grid = [
    ["对称", "分屏结构制造镜像关系，使两个不同场景看起来属于同一空间。", C.red],
    ["并置", "不同项目、身份和语境同时出现，形成跨越边界的意义比较。", C.blue],
    ["连续", "动作轨迹被剪辑成连续身体线条，强化运动的流动感。", C.green],
    ["反差", "肤色、性别、项目、年代与场景差异被保留，突出多样性。", C.yellow],
    ["节奏", "剪辑速度与音乐、旁白共同递进，形成广告短片的情绪曲线。", C.cyan],
    ["符号", "体育动作被转化为“不停止”的象征，而非单纯比赛记录。", "9C36B5"],
  ];
  grid.forEach((g, i) => {
    const x = 0.72 + (i % 3) * 4.08;
    const y = 1.78 + Math.floor(i / 3) * 2.18;
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.58, h: 1.48, rectRadius: 0.08, fill: { color: C.white }, line: { color: "E4DED3" } });
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.24, y: y + 0.28, w: 0.48, h: 0.48, fill: { color: g[2] }, line: { color: g[2] } });
    s.addText(g[0], { x: x + 0.9, y: y + 0.27, w: 1.5, h: 0.26, fontSize: 15, bold: true, color: C.ink, margin: 0 });
    s.addText(g[1], { x: x + 0.9, y: y + 0.72, w: 2.25, h: 0.45, fontSize: 9.4, color: C.dark, fit: "shrink", margin: 0 });
  });
  s.addText("它的核心影像语言是：用形式上的“一分为二”，表达意义上的“合二为一”。", {
    x: 1.38, y: 6.35, w: 10.45, h: 0.35, fontSize: 15, bold: true, color: C.red, align: "center", margin: 0,
  });
  addFooter(s, 9);
}

// 10 Aesthetic features
{
  const s = pptx.addSlide();
  addBg(s, "101418");
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: "101418" }, line: { color: "101418" } });
  addHeader(s, "AESTHETIC FEATURES", "审美特点：商业影像中的公共情绪", { dark: true });
  splitScene(s, 0.65, 1.75, 4.75, 3.5, { left: "B91C1C", right: "075985" });
  const aest = [
    ["统一中的多样", "画面保留差异，但通过统一运动节奏形成共同体。"],
    ["纪实中的设计", "素材带有真实赛事质感，分屏拼接又高度人工设计。"],
    ["热血中的克制", "没有过度煽情台词，而以精准剪辑让情绪自然累积。"],
    ["品牌中的公共性", "广告目的被隐藏在更广泛的社会情绪与体育精神里。"],
  ];
  aest.forEach((a, i) => {
    const y = 1.76 + i * 0.94;
    s.addText(a[0], { x: 6.15, y, w: 2.05, h: 0.25, fontSize: 13.5, bold: true, color: [C.red, C.cyan, C.yellow, C.green][i], margin: 0 });
    s.addText(a[1], { x: 8.25, y: y - 0.02, w: 3.7, h: 0.35, fontSize: 10.5, color: "E5E7EB", fit: "shrink", margin: 0 });
  });
  s.addText("审美价值在于：它让观众先被画面的巧妙结构吸引，再被结构背后的共同情感说服。", {
    x: 1.1, y: 6.28, w: 11.2, h: 0.34, fontSize: 14, bold: true, color: C.white, align: "center", margin: 0,
  });
  addFooter(s, 10, true);
}

// 11 Evaluation
{
  const s = pptx.addSlide();
  addBg(s);
  addHeader(s, "MY VIEW", "个人评价与启示");
  s.addText("《You Can’t Stop Us》的成功不只在于“剪得炫”，而在于它把技术形式变成了主题本身。", {
    x: 0.9, y: 1.8, w: 11.4, h: 0.55, fontSize: 19, bold: true, color: C.ink, align: "center", fit: "shrink", margin: 0,
  });
  const points = [
    ["形式服务主题", "分屏不只是视觉特效，而是“分离中仍连接”的主题隐喻。"],
    ["素材重组产生新意义", "旧有体育片段在新的剪辑关系中获得新的社会表达。"],
    ["综合影像的学习价值", "做综合影像时，应先明确主题，再选择素材、技术和节奏。"],
  ];
  points.forEach((p, i) => {
    const x = 1.15 + i * 3.75;
    s.addShape(pptx.ShapeType.roundRect, { x, y: 3.02, w: 3.1, h: 2.25, rectRadius: 0.08, fill: { color: C.white }, line: { color: "E4DED3" } });
    s.addText(`${i + 1}`, { x: x + 0.25, y: 3.28, w: 0.42, h: 0.28, fontSize: 16, bold: true, color: [C.red, C.blue, C.green][i], margin: 0 });
    s.addText(p[0], { x: x + 0.82, y: 3.30, w: 1.9, h: 0.28, fontSize: 13, bold: true, color: C.ink, margin: 0 });
    s.addText(p[1], { x: x + 0.32, y: 3.95, w: 2.45, h: 0.72, fontSize: 10.2, color: C.dark, align: "center", fit: "shrink", margin: 0 });
  });
  s.addText("因此，本作品可作为综合影像实践的优秀案例：它说明技术并不是目的，技术最终要帮助作品建立观点、情绪与审美秩序。", {
    x: 1.1, y: 6.08, w: 11.2, h: 0.42, fontSize: 13.5, bold: true, color: C.red, align: "center", fit: "shrink", margin: 0,
  });
  addFooter(s, 11);
}

// 12 References
{
  const s = pptx.addSlide();
  addBg(s, "FFFDF8");
  addHeader(s, "REFERENCES", "参考资料与素材说明");
  const refs = [
    "Wieden+Kennedy: Nike — You Can’t Stop Us, https://www.wk.com/work/nike-you-cant-stop-us/",
    "Colossal: A Remarkable Split-Screen Montage for Nike, https://www.thisiscolossal.com/2021/04/nike-you-cant-stop-us/",
    "Digital Synopsis: Nike’s New Ad Is An Editing Marvel, https://digitalsynopsis.com/advertising/nike-you-cant-stop-us/",
    "Musicbed Blog: Case Study on Nike’s “You Can’t Stop Us”, https://www.musicbed.com/articles/at-musicbed/case-study-musicbed-custom-work-nike-you-cant-stop-us/",
    "课堂作业照片：/Users/baojiale/Downloads/1263.JPG；本 PPT 的分屏运动画面为分析示意图，并非原片截图。",
  ];
  refs.forEach((r, i) => {
    s.addText(`${i + 1}.`, { x: 1.0, y: 1.85 + i * 0.72, w: 0.35, h: 0.2, fontSize: 10.5, bold: true, color: C.red, margin: 0 });
    s.addText(r, { x: 1.42, y: 1.84 + i * 0.72, w: 10.4, h: 0.28, fontSize: 11.5, color: C.ink, fit: "shrink", margin: 0 });
  });
  s.addShape(pptx.ShapeType.line, { x: 1.0, y: 5.78, w: 10.8, h: 0, line: { color: "DDD6CB", width: 1 } });
  s.addText("提交建议：若老师要求 PDF，可从 PowerPoint / Keynote 中导出 PDF；我也另外生成了一份同名 PDF 便于直接提交。", {
    x: 1.0, y: 6.15, w: 10.8, h: 0.3, fontSize: 11.5, bold: true, color: C.blue, align: "center", margin: 0,
  });
  addFooter(s, 12);
}

pptx.writeFile({ fileName: pptxPath });
