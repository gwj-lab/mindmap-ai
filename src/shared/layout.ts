export const DEFAULT_DOCK_LAYOUT = {
  global: {
    tabEnableClose: true,
    tabEnableRename: false,
    splitterSize: 7,
    splitterExtra: 4,
    enableEdgeDock: true
  },
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 62,
        selected: 0,
        children: [{ type: "tab", name: "思维导图", component: "mindmap", id: "mindmap", enableClose: false }]
      },
      {
        type: "row",
        weight: 38,
        children: [
          {
            type: "tabset",
            id: "ai-tabs",
            config: { aiTabs: true },
            enableDeleteWhenEmpty: false,
            weight: 72,
            selected: 0,
            children: [{ type: "tab", name: "ChatGPT", component: "ai", id: "ai", config: { provider: "chatgpt" } }]
          },
          {
            type: "tabset",
            weight: 28,
            selected: 0,
            children: [
              { type: "tab", name: "候选节点", component: "candidates", id: "candidates" },
              { type: "tab", name: "样式", component: "styles", id: "styles" }
            ]
          }
        ]
      }
    ]
  }
} as const;
