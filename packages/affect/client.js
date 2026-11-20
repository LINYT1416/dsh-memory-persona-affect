window.__ModuleLoader__.load({
  id: 'dsh-affect',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 设置页里的一页：直接嵌仪表盘（仪表盘自己 2 秒轮询 /affect/live）
    function AffectPanel() {
      return h('div', {
        style: { width: '100%', height: '100%', minHeight: '560px', display: 'flex', flexDirection: 'column' },
      }, h('iframe', {
        src: '/affect/dashboard',
        title: '她此刻',
        style: {
          flex: '1 1 auto', width: '100%', minHeight: '560px', border: '0',
          borderRadius: '12px', background: '#0d1117',
        },
      }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'affect',
          order: 26,
          label: '她的心情',
        }, AffectPanel))
      },
    }
  },
})
