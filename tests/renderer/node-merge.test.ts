import { expect, test } from 'vitest';
import { mergePortableNodes, nodesForMerge } from '../../src/renderer/state/node-merge.js';
import type { ActiveProjectSnapshot } from '../../src/shared/types.js';

const snapshot: ActiveProjectSnapshot = {
  manifest: { schemaVersion: 2, projectId: 'project', parentProjectId: null, name: 'Project', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' },
  state: { schemaVersion: 2, dockLayout: {}, candidates: [], history: [], trash: [], uiPreferences: { theme: 'system', autoHoverCapture: true, captureMode: 'single', titleSource: 'local' } },
  missingAnswerIds: [], mindmap: { uid: 'root', text: 'Root', children: [
  { uid: 'a', text: 'A', answerId: 'doc-a', children: [{ uid: 'a1', text: 'A1', children: [] }] },
  { uid: 'b', text: 'B', answerId: 'doc-b', conceptId: 'concept-b', tags: ['概念'], children: [{ uid: 'b1', text: 'B1', answerId: 'child-doc', children: [] }] },
  { uid: 'c', text: 'C', children: [] }
] } };
test('merges into the chosen position with one selected attachment and retains all child nodes', () => {
  const next = mergePortableNodes(snapshot, ['a', 'b'], 'a', 'AB', 'doc-b');
  expect(next.mindmap.children).toHaveLength(2);
  expect(next.mindmap.children[0]).toMatchObject({ uid: 'a', text: 'AB', answerId: 'doc-b', conceptId: 'concept-b', tags: ['概念'], children: [{ uid: 'a1' }, { uid: 'b1', answerId: 'child-doc' }] });
  expect(snapshot.mindmap.children).toHaveLength(3);
});
test('allows no attachment and rejects invalid documents, ancestor selections and readonly changes', () => {
  expect(mergePortableNodes(snapshot, ['a', 'b'], 'b', 'AB').mindmap.children[0]!.answerId).toBeUndefined();
  expect(() => mergePortableNodes(snapshot, ['a', 'b'], 'a', 'AB', 'unselected')).toThrow('一篇文档');
  expect(() => nodesForMerge(snapshot.mindmap, ['a', 'a1'])).toThrow('父子节点');
  expect(() => mergePortableNodes({ ...snapshot, readOnly: true }, ['a', 'b'], 'a', 'AB')).toThrow('只读');
});
