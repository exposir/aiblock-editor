---
layout: home

hero:
  name: AIBlock Editor
  text: 本地块级文档编辑器
  tagline: 用块组织长文档，用 Markdown 交换内容，用 aiblock-doc 把本地知识库接进终端和 AI 工具。
  image:
    src: /logo.svg
    alt: 暖炭底上的折角文档图标，带陶土红块把手
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: CLI 与 Agent Skill
      link: /guide/cli-and-skill

features:
  - title: 块级排版
    details: 拖动单块或多块调整顺序，向边缘拖放可建栏摆放。用斜杠菜单按中文或拼音插入块。
    link: /guide/blocks-and-markdown#块编辑
  - title: 多页工作区
    details: 用页面树、面包屑和大纲管理相关文档。划词评论随各页保存，切页时只加载需要的正文。
    link: /guide/architecture#工作区存储
  - title: Markdown 导入与导出
    details: 保留列表、表格、提示块、折叠块与多栏的内容结构，可复制整页 Markdown。
    link: /guide/blocks-and-markdown#markdown-往返
  - title: 图表与公式
    details: 在文档内预览 Mermaid 和 KaTeX，使用源码或分栏视图编辑图表与公式。
    link: /guide/blocks-and-markdown#图表与公式
  - title: 批量贴图
    details: 一批最多 200 张，一步撤销。图片按内容去重，和正文分开存储，滚近才加载位图。
    link: /guide/blocks-and-markdown#批量贴图
  - title: 本地 CLI 与 Agent Skill
    details: 用六条命令操作桌面工作区。写操作带锁和版本校验，桌面端感知外部改动。
    link: /guide/cli-and-skill
---

## 界面预览

左侧页面树用于切换文档，正文里的标题、待办和分栏可以按块编辑。右侧是当前页的划词评论。

<div class="showcase-frame light-only">

![浅色界面的页面树、正文和评论侧栏](/images/editor-light.png)

</div>

<div class="showcase-frame dark-only">

![深色界面的页面树、正文和评论侧栏](/images/editor-dark.png)

</div>

## 本地体验

```sh
git clone https://github.com/exposir/aiblock-editor.git
cd aiblock-editor
pnpm install
pnpm dev
```

打开 Vite 输出的地址，从页面树进入示例文档。[环境要求与其他入口](/guide/getting-started)
