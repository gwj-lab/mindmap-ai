import { Actions, Model, type BorderNode, type TabNode, type TabSetNode } from "flexlayout-react";
import { AI_PROVIDERS, isProviderId } from "../../shared/ai-providers.js";
import { DEFAULT_DOCK_LAYOUT } from "../../shared/layout.js";
import type { AiTab, ProviderId } from "../../shared/types.js";

export function getAiTabProvider(node: TabNode): ProviderId {
  const provider: unknown = node.getConfig()?.provider;
  return isProviderId(provider) ? provider : "chatgpt";
}

export function collectAiTabs(model: Model): AiTab[] {
  const tabs: AiTab[] = [];
  model.visitNodes((node) => {
    if (node.getType() === "tab" && (node as TabNode).getComponent() === "ai") {
      tabs.push({ id: node.getId(), provider: getAiTabProvider(node as TabNode) });
    }
  });
  return tabs;
}

export function isAiTabSet(node: TabSetNode | BorderNode): boolean {
  return node.getConfig()?.aiTabs === true || node.getChildren().some((child) =>
    child.getType() === "tab" && (child as TabNode).getComponent() === "ai"
  );
}

export function createLayoutModel(json: unknown): Model {
  let model: Model;
  try {
    model = Model.fromJson(structuredClone(json) as never);
  } catch {
    model = Model.fromJson(structuredClone(DEFAULT_DOCK_LAYOUT) as never);
  }
  // Old workspaces have a single AI tab without a provider config.
  model.visitNodes((node) => {
    if (node.getType() === "tab" && (node as TabNode).getComponent() === "ai") {
      const provider = getAiTabProvider(node as TabNode);
      model.doAction(Actions.updateNodeAttributes(node.getId(), {
        name: AI_PROVIDERS[provider].name, config: { provider }
      }));
    } else if (node.getType() === "tabset" && isAiTabSet(node as TabSetNode)) {
      model.doAction(Actions.updateNodeAttributes(node.getId(), {
        config: { aiTabs: true }, enableDeleteWhenEmpty: false
      }));
    }
  });
  return model;
}
