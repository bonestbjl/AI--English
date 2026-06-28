from reportlab.lib.pagesizes import landscape
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
import os
import textwrap

OUT_DIR = "/Users/baojiale/Documents/英语趣味学习/outputs/ppt-homework-nike"
PDF_PATH = os.path.join(OUT_DIR, "综合影像调研报告_Nike_You_Cant_Stop_Us.pdf")
ASSIGNMENT_IMAGE = "/Users/baojiale/Downloads/1263.JPG"

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
FONT = "STSong-Light"
PAGE = (13.333 * inch, 7.5 * inch)
W, H = PAGE

C = {
    "ink": HexColor("#111111"),
    "paper": HexColor("#F7F4EF"),
    "white": HexColor("#FFFFFF"),
    "red": HexColor("#E93D35"),
    "blue": HexColor("#1C7ED6"),
    "cyan": HexColor("#4DD0E1"),
    "yellow": HexColor("#F7C948"),
    "green": HexColor("#2F9E44"),
    "gray": HexColor("#6B7280"),
    "dark": HexColor("#1F2937"),
    "line": HexColor("#D7D0C5"),
}

def mm(v):
    return v * inch

def bg(c, color=C["paper"]):
    c.setFillColor(color)
    c.rect(0, 0, W, H, fill=1, stroke=0)

def text(c, s, x, y, size=14, color=C["ink"], bold=False, max_chars=None, leading=None, align="left"):
    c.setFillColor(color)
    c.setFont(FONT, size)
    if max_chars:
        lines = []
        for para in str(s).split("\n"):
            lines.extend(textwrap.wrap(para, max_chars) or [""])
    else:
        lines = str(s).split("\n")
    leading = leading or size * 1.35
    for i, line in enumerate(lines):
        yy = y - i * leading
        if align == "center":
            c.drawCentredString(x, yy, line)
        else:
            c.drawString(x, yy, line)

def header(c, kicker, title, dark=False, page=1):
    tc = C["white"] if dark else C["ink"]
    kc = C["cyan"] if dark else C["red"]
    text(c, kicker, mm(0.65), H - mm(0.58), 8.5, kc)
    text(c, title, mm(0.65), H - mm(1.02), 23, tc)
    c.setStrokeColor(HexColor("#FFFFFF") if dark else C["line"])
    c.setLineWidth(0.8)
    c.line(mm(0.65), H - mm(1.36), W - mm(0.65), H - mm(1.36))
    text(c, f"综合影像实践 · 调研报告  |  {page:02d}", mm(0.65), mm(0.35), 7.5, HexColor("#D1D5DB") if dark else C["gray"])

def card(c, x, y, w, h, title, body, accent=C["red"]):
    c.setFillColor(C["white"])
    c.setStrokeColor(HexColor("#E4DED3"))
    c.roundRect(x, y, w, h, 5, fill=1, stroke=1)
    c.setFillColor(accent)
    c.rect(x, y, 5, h, fill=1, stroke=0)
    text(c, title, x + 16, y + h - 22, 12, C["ink"])
    text(c, body, x + 16, y + h - 48, 9.3, C["dark"], max_chars=18, leading=13)

def split_scene(c, x, y, w, h, left=C["red"], right=C["blue"]):
    c.setFillColor(left)
    c.rect(x, y, w / 2, h, fill=1, stroke=0)
    c.setFillColor(right)
    c.rect(x + w / 2, y, w / 2, h, fill=1, stroke=0)
    c.setStrokeColor(C["white"])
    c.setLineWidth(2.5)
    c.line(x + w / 2, y, x + w / 2, y + h)
    c.setStrokeColor(C["white"])
    c.setLineWidth(4)
    c.arc(x + w * 0.12, y + h * 0.25, x + w * 0.48, y + h * 0.82, 210, 120)
    c.arc(x + w * 0.52, y + h * 0.20, x + w * 0.87, y + h * 0.80, 210, 120)
    c.setFillColor(C["white"])
    c.circle(x + w * 0.44, y + h * 0.72, 9, fill=1, stroke=0)
    c.circle(x + w * 0.56, y + h * 0.75, 9, fill=1, stroke=0)

def pill(c, label, x, y, w, fill, tc=C["white"]):
    c.setFillColor(fill)
    c.roundRect(x, y, w, 23, 6, fill=1, stroke=0)
    text(c, label, x + w / 2, y + 8, 8.5, tc, align="center")

slides = []

def make_pdf():
    c = canvas.Canvas(PDF_PATH, pagesize=PAGE)

    # 1
    bg(c, C["ink"])
    split_scene(c, mm(6.7), 0, W - mm(6.7), H)
    c.setFillColor(C["ink"])
    c.rect(0, 0, mm(6.9), H, fill=1, stroke=0)
    text(c, "综合影像实践 · 小作业1", mm(0.65), H - mm(0.75), 9, C["cyan"])
    text(c, "Nike《You Can’t Stop Us》", mm(0.65), H - mm(1.68), 25, C["white"])
    text(c, "综合影像作品调研报告", mm(0.65), H - mm(2.28), 20, C["white"])
    text(c, "从分屏剪辑、素材拼贴与体育精神叙事出发，分析一支广告短片如何把大量异质影像组织成具有情感力量的综合影像。", mm(0.7), H - mm(3.25), 12, HexColor("#E5E7EB"), max_chars=24)
    pill(c, "广告短片", mm(0.7), H - mm(4.9), mm(1.05), C["red"])
    pill(c, "分屏蒙太奇", mm(1.9), H - mm(4.9), mm(1.35), C["blue"])
    pill(c, "社会情绪传播", mm(3.4), H - mm(4.9), mm(1.65), C["yellow"], C["ink"])
    text(c, "作品发布：2020 年 7 月  |  调研报告", mm(0.68), mm(0.55), 8, HexColor("#CBD5E1"))
    c.showPage()

    # 2
    bg(c); header(c, "TASK RESPONSE", "作业要求与选题说明", page=2)
    if os.path.exists(ASSIGNMENT_IMAGE):
        img = ImageReader(ASSIGNMENT_IMAGE)
        c.drawImage(img, mm(0.65), mm(1.0), width=mm(4.2), height=mm(4.75), preserveAspectRatio=True, anchor="c")
    text(c, "本报告选择 Nike 2020 年广告短片《You Can’t Stop Us》作为代表性“综合影像”作品。", mm(5.35), H - mm(2.05), 16, C["ink"], max_chars=29)
    card(c, mm(5.35), H - mm(4.9), mm(2.1), mm(1.35), "01 基本信息", "片名、类型、年份、品牌、主创与传播场景", C["red"])
    card(c, mm(7.65), H - mm(4.9), mm(2.1), mm(1.35), "02 背景目的", "疫情与体育停摆语境中，重建集体信念与品牌精神", C["blue"])
    card(c, mm(9.95), H - mm(4.9), mm(2.1), mm(1.35), "03 技术手法", "素材检索、动作匹配、分屏拼接、节奏剪辑与声音设计", C["yellow"])
    card(c, mm(5.35), H - mm(6.25), mm(6.7), mm(0.68), "04 影像语言与审美特点", "用“看似不同、实则相连”的视觉结构，表达体育、社会与个体经验之间的共振。", C["green"])
    c.showPage()

    # 3
    bg(c); header(c, "PART 01", "作品基本信息", page=3)
    split_scene(c, mm(0.65), H - mm(5.78), mm(4.85), mm(4.05))
    rows = [
        ("作品类型", "品牌广告短片 / 体育影像拼贴 / 分屏蒙太奇"),
        ("发布时间", "2020 年 7 月"),
        ("品牌与代理", "Nike；Wieden+Kennedy Portland"),
        ("旁白", "Megan Rapinoe"),
        ("核心形式", "36 组分屏画面，将 72 个运动镜头进行动作与构图匹配"),
        ("传播主题", "You Can’t Stop Us：困境中仍保持连接、行动与希望"),
    ]
    for i, (k, v) in enumerate(rows):
        y = H - mm(1.9 + i * 0.72)
        text(c, k, mm(6.05), y, 9.5, C["red"])
        text(c, v, mm(7.45), y, 11.5, C["ink"], max_chars=26)
    c.showPage()

    # Remaining concise report pages
    page_data = [
        ("WHY THIS WORK", "为什么它具有“综合影像”代表性", [
            ("素材来源综合", "把不同赛事、运动项目、国家地区与人物身份的影像重新组织。"),
            ("媒介形态综合", "既是广告，也是短片、社交媒体传播内容与体育文化叙事。"),
            ("技术语言综合", "分屏、匹配剪辑、档案素材筛选、声音旁白与音乐节奏共同构成意义。"),
            ("情感主题综合", "从个体动作上升到群体信念，把体育、疫情、平权与共同体经验连接。"),
        ]),
        ("PART 02", "创作背景与目的", [
            ("特殊时代语境", "2020 年全球公共卫生危机使体育赛事、训练和线下社交被打断，作品回应这种“停摆感”。"),
            ("品牌传播目的", "Nike 延续“体育改变世界”的品牌叙事，把品牌放在坚持、团结、突破的价值语境中。"),
            ("情感动员策略", "旁白从个人经验扩展到群体经验，分屏画面让不同动作在视觉上接续。"),
        ]),
        ("PART 03", "技术手法：从素材库到分屏叙事", [
            ("素材检索", "寻找不同运动、人物与历史片段。"),
            ("动作匹配", "按身体姿态、方向、速度进行配对。"),
            ("构图拼接", "将左右两半画面接成“一个动作”。"),
            ("节奏剪辑", "配合旁白、音乐与情绪递进。"),
            ("意义生成", "把多元个体变成共同体叙事。"),
        ]),
        ("TECHNIQUE FOCUS", "分屏匹配：让差异画面产生同一动作", [
            ("中心线", "左右画面以中线为缝合点，身体动作在中线附近衔接。"),
            ("运动方向", "冲刺、起跳、转身等动作保持同向或互补。"),
            ("画面重心", "头部、肩部、球体或肢体落在相近位置，降低拼接突兀感。"),
            ("意义转化", "不同性别、项目、国家的影像被剪成同一个节奏，暗示共同处境。"),
        ]),
        ("SOUND & RHYTHM", "声音与节奏：旁白推动意义上升", [
            ("开端", "从困境和限制进入，画面强调停顿、分离与不确定。"),
            ("推进", "镜头匹配越来越密集，运动动作形成连续爆发。"),
            ("高潮", "旁白、音乐与高强度动作叠合，情绪转为团结与希望。"),
            ("收束", "品牌口号回到标题，完成从个人到共同体的价值归纳。"),
        ]),
        ("PART 04", "影像语言分析", [
            ("对称", "分屏结构制造镜像关系，使两个不同场景看起来属于同一空间。"),
            ("并置", "不同项目、身份和语境同时出现，形成跨越边界的意义比较。"),
            ("连续", "动作轨迹被剪辑成连续身体线条，强化运动的流动感。"),
            ("反差", "肤色、性别、项目、年代与场景差异被保留，突出多样性。"),
            ("节奏", "剪辑速度与音乐、旁白共同递进，形成广告短片的情绪曲线。"),
            ("符号", "体育动作被转化为“不停止”的象征，而非单纯比赛记录。"),
        ]),
        ("AESTHETIC FEATURES", "审美特点：商业影像中的公共情绪", [
            ("统一中的多样", "画面保留差异，但通过统一运动节奏形成共同体。"),
            ("纪实中的设计", "素材带有真实赛事质感，分屏拼接又高度人工设计。"),
            ("热血中的克制", "以精准剪辑让情绪自然累积。"),
            ("品牌中的公共性", "广告目的被隐藏在更广泛的社会情绪与体育精神里。"),
        ]),
        ("MY VIEW", "个人评价与启示", [
            ("形式服务主题", "分屏不只是视觉特效，而是“分离中仍连接”的主题隐喻。"),
            ("素材重组产生新意义", "旧有体育片段在新的剪辑关系中获得新的社会表达。"),
            ("综合影像的学习价值", "做综合影像时，应先明确主题，再选择素材、技术和节奏。"),
        ]),
        ("REFERENCES", "参考资料与素材说明", [
            ("Wieden+Kennedy", "Nike — You Can’t Stop Us, https://www.wk.com/work/nike-you-cant-stop-us/"),
            ("Colossal", "A Remarkable Split-Screen Montage for Nike, https://www.thisiscolossal.com/2021/04/nike-you-cant-stop-us/"),
            ("Digital Synopsis", "Nike’s New Ad Is An Editing Marvel, https://digitalsynopsis.com/advertising/nike-you-cant-stop-us/"),
            ("Musicbed Blog", "Case Study on Nike’s “You Can’t Stop Us”, https://www.musicbed.com/articles/at-musicbed/case-study-musicbed-custom-work-nike-you-cant-stop-us/"),
            ("说明", "课堂作业照片来自 /Users/baojiale/Downloads/1263.JPG；分屏运动画面为分析示意图。"),
        ]),
    ]
    for idx, (kicker, title, items) in enumerate(page_data, start=4):
        dark = idx in (6, 10)
        bg(c, HexColor("#101418") if dark else C["paper"])
        header(c, kicker, title, dark=dark, page=idx)
        if idx in (6, 10):
            split_scene(c, mm(0.8), H - mm(5.15), mm(4.8), mm(3.2), C["red"], C["blue"])
            x0 = mm(6.2)
        else:
            x0 = mm(0.95)
        y0 = H - mm(1.95)
        for j, (t, b) in enumerate(items):
            x = x0 + (j % 2) * mm(5.65 if not dark else 0)
            y = y0 - (j if dark else j // 2) * mm(1.08 if dark else 1.62)
            if not dark:
                c.setFillColor(C["white"])
                c.setStrokeColor(HexColor("#E4DED3"))
                c.roundRect(x, y - mm(0.88), mm(5.05), mm(1.18), 6, fill=1, stroke=1)
                color = [C["red"], C["blue"], C["green"], C["yellow"], C["cyan"]][j % 5]
                c.setFillColor(color); c.circle(x + 15, y + 8, 6, fill=1, stroke=0)
                text(c, t, x + 32, y + 2, 13, C["ink"])
                text(c, b, x + 32, y - 22, 9.8, C["dark"], max_chars=29)
            else:
                color = [C["red"], C["cyan"], C["yellow"], C["green"], C["blue"]][j % 5]
                text(c, t, x0, y, 13, color)
                text(c, b, x0 + mm(1.65), y, 10.2, HexColor("#E5E7EB"), max_chars=25)
        if idx == 4:
            text(c, "结论：把“不同来源的影像”通过新的剪辑逻辑变成“一个共同叙事”。", W / 2, mm(0.85), 13, C["red"], align="center")
        if idx == 11:
            text(c, "技术并不是目的，技术最终要帮助作品建立观点、情绪与审美秩序。", W / 2, mm(0.85), 13, C["red"], align="center")
        c.showPage()

    c.save()

if __name__ == "__main__":
    make_pdf()
    print(PDF_PATH)
