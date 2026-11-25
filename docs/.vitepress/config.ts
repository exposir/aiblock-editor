import { defineConfig } from 'vitepress'

const base = '/aiblock-editor/'
const repository = 'https://github.com/exposir/aiblock-editor'
const site = `https://exposir.github.io${base}`
const title = 'AIBlock Editor'
const description = '用块组织长文档的本地编辑器，支持 Markdown、桌面工作区和 aiblock-doc CLI。'

export default defineConfig({
  lang: 'zh-CN',
  title,
  description,
  base,
  lastUpdated: true,
  vite: { server: { port: 4174, strictPort: true } },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: site }],
    ['meta', { property: 'og:image', content: `${site}images/editor-light.png` }],
  ],
  themeConfig: {
    logo: { src: '/logo.svg', width: 34, height: 34, alt: title },
    nav: [
      { text: '快速开始', link: '/guide/getting-started' },
      { text: 'CLI 与 Skill', link: '/guide/cli-and-skill' },
      { text: '架构与实测', link: '/guide/architecture' },
      { text: '开发与排查', link: '/guide/development' },
      { text: 'CLI 参考', link: '/reference/cli-api' },
    ],
    sidebar: [
      {
        text: '使用指南',
        items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '块编辑与 Markdown', link: '/guide/blocks-and-markdown' },
          { text: 'CLI 与 Agent Skill', link: '/guide/cli-and-skill' },
          { text: '架构与实测', link: '/guide/architecture' },
          { text: '开发与排查', link: '/guide/development' },
        ],
      },
      { text: '参考', items: [{ text: 'CLI 命令与 JSON 契约', link: '/reference/cli-api' }] },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: '在 GitHub 上编辑此页' },
    lastUpdated: { text: '最后更新' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到相关页面',
            resetButtonTitle: '清空搜索',
            footer: { selectText: '选择', navigateText: '导航', closeText: '关闭' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '主题',
    darkModeSwitchTitle: '切换到深色主题',
    lightModeSwitchTitle: '切换到浅色主题',
    skipToContentLabel: '跳到正文',
    footer: { message: '源码采用 MIT 许可证。' },
  },
})
