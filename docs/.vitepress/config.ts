import { defineConfig } from 'vitepress'

const base = '/aiblock-editor/'
const repository = 'https://github.com/exposir/aiblock-editor'

export default defineConfig({
  lang: 'zh-CN',
  title: 'AIBlock Editor',
  description: '本地块级文档编辑器，支持 Markdown、桌面工作区和 aiblock-doc CLI。',
  base,
  vite: { server: { port: 4174, strictPort: true } },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }]],
  themeConfig: {
    logo: { src: '/logo.svg', width: 34, height: 34, alt: 'AIBlock Editor' },
    nav: [
      { text: '使用指南', link: '/guide/getting-started' },
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
        ],
      },
      { text: '参考', items: [{ text: 'CLI 命令与 JSON 契约', link: '/reference/cli-api' }] },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
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
