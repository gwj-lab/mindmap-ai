import { describe, expect, test } from "vitest";
import {
  IPC,
  projectCreateRequestSchema,
  projectIdRequestSchema,
  projectRenameRequestSchema,
  recentWorkspaceIdRequestSchema
} from "../../src/shared/ipc.js";
import { isTrustedIpcSender } from "../../src/main/ipc-guards.js";

const PROJECT_ID = "2cb66115-270c-4107-89e0-f61508c14d2b";

describe("workspace IPC contract", () => {
  test("publishes workspace and project navigation channels", () => {
    expect(IPC).toMatchObject({
      workspaceCreate: "workspace:create",
      workspaceOpen: "workspace:open",
      workspaceGetSummary: "workspace:get-summary",
      workspaceRestoreLast: "workspace:restore-last",
      workspaceListRecent: "workspace:list-recent",
      workspaceSwitchRecent: "workspace:switch-recent",
      workspaceForgetRecent: "workspace:forget-recent",
      workspaceProjectCreate: "workspace-project:create",
      workspaceProjectSwitch: "workspace-project:switch",
      workspaceProjectRename: "workspace-project:rename",
      workspaceProjectOpenInExplorer: "workspace-project:open-in-explorer"
    });
  });

  test("accepts only opaque recent-workspace identifiers for switching", () => {
    const id = "7ca134b0-2c87-46e6-92c8-6bdde8a69c37";
    expect(recentWorkspaceIdRequestSchema.parse({ id })).toEqual({ id });
    expect(() => recentWorkspaceIdRequestSchema.parse({ id: "C:\\Workspace" })).toThrow();
    expect(() => recentWorkspaceIdRequestSchema.parse({ id, path: "C:\\Workspace" })).toThrow();
  });

  test("accepts identifiers and names but no renderer filesystem paths", () => {
    expect(projectCreateRequestSchema.parse({ name: "Child", parentProjectId: PROJECT_ID })).toEqual({
      name: "Child",
      parentProjectId: PROJECT_ID
    });
    expect(projectIdRequestSchema.parse({ projectId: PROJECT_ID })).toEqual({ projectId: PROJECT_ID });
    expect(projectRenameRequestSchema.parse({ projectId: PROJECT_ID, name: "Renamed" })).toEqual({
      projectId: PROJECT_ID,
      name: "Renamed"
    });

    expect(() => projectIdRequestSchema.parse({ projectId: "..\\outside" })).toThrow();
    expect(() => projectCreateRequestSchema.parse({ name: "x".repeat(121), parentProjectId: null })).toThrow();
    expect(() => projectCreateRequestSchema.parse({
      name: "Child",
      parentProjectId: null,
      path: "C:\\secrets"
    })).toThrow();
  });

  test("trusts only the exact local renderer sender", () => {
    const expected = {};
    expect(isTrustedIpcSender(expected, expected)).toBe(true);
    expect(isTrustedIpcSender({}, expected)).toBe(false);
    expect(isTrustedIpcSender(null, expected)).toBe(false);
  });
});
