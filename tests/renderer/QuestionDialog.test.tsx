// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { QuestionDialog } from '../../src/renderer/src/components/QuestionDialog.js';
import { DEFAULT_QUESTION_SETTINGS } from '../../src/shared/concepts.js';

afterEach(cleanup);
const request = { sourceAnswerId: 'source', sourceTitle: '回归模型', selection: { text: '残差', sentence: '残差是差值。', prefix: '', suffix: '是差值。' } };
test('saves a default template separately and sends the edited question with the chosen website', async () => {
  const submit = vi.fn(async () => undefined); const save = vi.fn(async () => undefined);
  render(<QuestionDialog request={request} settings={{ ...DEFAULT_QUESTION_SETTINGS, provider: 'kimi', prompt: '解释 {selection}' }} onSubmit={submit} onSaveSettings={save} onClose={vi.fn()} />);
  expect(screen.getByLabelText('自定义问题')).toHaveValue('解释 残差');
  fireEvent.click(screen.getByText('答疑设置 · Kimi'));
  fireEvent.change(screen.getByLabelText('答疑网页模型'), { target: { value: 'deepseek' } });
  fireEvent.change(screen.getByLabelText('答疑初始提示词'), { target: { value: '分析 {title}：{selection}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存答疑设置' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ provider: 'deepseek', prompt: '分析 {title}：{selection}' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '应用到本次问题' })).toBeEnabled());
  expect(screen.getByLabelText('自定义问题')).toHaveValue('解释 残差');
  fireEvent.click(screen.getByRole('button', { name: '应用到本次问题' }));
  expect(screen.getByLabelText('自定义问题')).toHaveValue('分析 回归模型：残差');
  fireEvent.change(screen.getByLabelText('自定义问题'), { target: { value: '只用于本次的追问' } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith('只用于本次的追问', { provider: 'deepseek', prompt: '分析 {title}：{selection}' }));
});

test('shows validation errors before saving an unusable default template', () => {
  const save = vi.fn();
  render(<QuestionDialog request={request} onSubmit={vi.fn()} onSaveSettings={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('答疑设置 · 跟随来源平台'));
  fireEvent.change(screen.getByLabelText('答疑初始提示词'), { target: { value: '不含原文变量' } });
  fireEvent.click(screen.getByRole('button', { name: '保存答疑设置' }));
  expect(screen.getByRole('alert')).toHaveTextContent('模板必须包含 {selection}');
  expect(save).not.toHaveBeenCalled();
});
