import type { CommentThread } from './comments'

export const demoTitle = '文档协作与发布手册'

const demoQuote = '先向试点团队开放模板库'

export const demoComments: readonly CommentThread[] = [{
  id: 'demo-pilot-scope',
  quote: demoQuote,
  resolved: false,
  messages: [{ id: 'demo-message', author: '产品同事', text: '建议周四先开放给设计和运营团队，周五统一汇总反馈。' }],
}]

export const demoDocument = `
  <h1 data-block-id="demo-intro">文档协作与发布手册</h1>
  <p>本周发布团队将<span data-comment-id="demo-pilot-scope">${demoQuote}</span>，验证创建、分享和评论流程。</p>
  <aside data-callout data-icon="📌" data-theme="blue">
    <p><strong>发布前核对</strong></p>
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="true"><div><p>在预发环境完成模板创建和复制。</p></div></li>
      <li data-type="taskItem" data-checked="false"><div><p>核对试点团队成员权限。</p></div></li>
      <li data-type="taskItem" data-checked="false"><div><p>向支持团队同步反馈入口。</p></div></li>
    </ul>
  </aside>
  <h2 data-block-id="demo-plan">发布安排</h2>
  <p>发布窗口从周四 10:00 开始。首次开放前确认回滚开关和监控面板都可用。</p>
  <div data-toggle data-open="false">
    <div data-toggle-summary><strong>展开查看回滚步骤</strong></div>
    <div data-toggle-content>
      <p>暂停新增试点账号，保留已创建的模板。</p>
      <ol><li><p>关闭模板库入口开关。</p></li><li><p>记录报错样例并通知值班同事。</p></li></ol>
    </div>
  </div>
  <h2 data-block-id="demo-comparison">试点与全面开放</h2>
  <div data-column-list>
    <div data-column data-width="50">
      <h3 data-block-id="demo-pilot">试点阶段</h3>
      <p>向设计和运营团队开放。收集模板创建耗时与权限配置反馈。</p>
    </div>
    <div data-column data-width="50">
      <h3 data-block-id="demo-launch">全面开放</h3>
      <p>通过验收后扩大范围。同步变更说明并保留一周回滚窗口。</p>
    </div>
  </div>
  <h2 data-block-id="demo-checklist">验收记录</h2>
  <table>
    <tbody>
      <tr><th><p>检查项</p></th><th><p>通过标准</p></th><th><p>负责人</p></th></tr>
      <tr><td><p>模板创建</p></td><td><p>成功率 ≥ 99%</p><ul><li><p>覆盖空白模板与预置模板。</p></li></ul></td><td><p>研发</p></td></tr>
      <tr><td><p>分享权限</p></td><td><p>只读与可编辑权限均通过抽查。</p></td><td><p>测试</p></td></tr>
    </tbody>
  </table>
  <h2 data-block-id="demo-code">发布规则示例</h2>
  <p>服务端按创建成功率和权限抽查结果决定是否扩大范围。</p>
  <pre data-language="typescript"><code>type PilotReport = {
  creationRate: number
  permissionsVerified: boolean
}

function canExpand(report: PilotReport): boolean {
  return report.creationRate >= 0.99 &amp;&amp; report.permissionsVerified
}</code></pre>
  <h2 data-block-id="demo-editing">编辑提示</h2>
  <p>在空行键入 <code>/gl</code> 插入高亮块。按 Esc 选中当前块，再按 Shift + ↑ / ↓ 扩选。拖动左侧手柄把块移到另一个块的边缘，即可建栏。</p>
  <p></p>
`
