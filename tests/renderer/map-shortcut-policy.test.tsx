// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { shouldEnableMapShortcut } from "../../src/renderer/src/components/map-shortcut-policy.js";

describe("mind-map shortcut target policy", () => {
  afterEach(() => document.body.replaceChildren());

  test("allows body, SVG, and stale toolbar-button focus", () => {
    expect(shouldEnableMapShortcut(document.body)).toBe(true);
    expect(shouldEnableMapShortcut(
      document.createElementNS("http://www.w3.org/2000/svg", "text")
    )).toBe(true);
    expect(shouldEnableMapShortcut(document.createElement("button"))).toBe(true);
  });

  test("allows the map library's own node editor to finish with Enter or Tab", () => {
    const editor = document.createElement("div");
    editor.className = "smm-node-edit-wrap";
    editor.setAttribute("contenteditable", "true");

    expect(shouldEnableMapShortcut(editor)).toBe(true);
  });

  test("rejects text editors and dialog or menu controls", () => {
    document.body.innerHTML = `
      <input id="input">
      <textarea id="textarea"></textarea>
      <div contenteditable="true" id="editable"></div>
      <div class="cm-editor"><div id="cm"></div></div>
      <aside class="answer-dialog"><button id="dialog-button"></button></aside>
      <div class="node-context-menu"><button id="menu-button"></button></div>`;

    for (const id of ["input", "textarea", "editable", "cm", "dialog-button", "menu-button"]) {
      expect(shouldEnableMapShortcut(document.querySelector(`#${id}`))).toBe(false);
    }
  });
});
