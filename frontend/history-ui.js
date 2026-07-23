function node(tag, { className, text } = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(text, action, value, className = 'btn btn-ghost') {
  const control = node('button', { className, text });
  control.type = 'button';
  control.dataset.historyAction = action;
  if (value) control.dataset.historyId = value;
  return control;
}

function pageHeader(title, description, handlers, { detail = false } = {}) {
  const header = node('header', { className: 'history-page-head' });
  const copy = node('div');
  copy.append(
    node('div', { className: 'home-eyebrow', text: '我的教练记录' }),
    node('h1', { className: 'history-title', text: title }),
    node('p', { className: 'history-lead', text: description }),
  );
  const actions = node('div', { className: 'history-head-actions' });
  if (detail) actions.append(button('返回历史列表', 'back-list'));
  actions.append(button('返回首页', 'home'));
  header.append(copy, actions);
  header.querySelector('[data-history-action="home"]')
    .addEventListener('click', handlers.goHome);
  header.querySelector('[data-history-action="back-list"]')
    ?.addEventListener('click', handlers.openHistory);
  return header;
}

function formatTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function markdownSection(title, value, className = '') {
  const section = node('section', { className: `history-section ${className}`.trim() });
  section.append(node('h2', { className: 'history-section-title', text: title }));
  const content = node('div', { className: 'markdown-body' });
  window.renderMarkdown(content, Array.isArray(value) ? value.join('\n') : value || '');
  section.append(content);
  return section;
}

export function renderHistoryList(state, handlers) {
  const page = node('section', { className: 'history-page history-list-page' });
  page.append(pageHeader(
    '历史记录',
    '这里只显示当前账号保存的教练记录。记录不会自动过期，可由你主动删除。',
    handlers,
  ));
  const list = node('div', { className: 'history-list' });
  if (state.historySync.status === 'loading') {
    list.append(node('p', { className: 'history-empty', text: '正在读取历史记录…' }));
  } else if (state.historyItems.length === 0) {
    list.append(node('p', { className: 'history-empty', text: '暂无历史记录。' }));
  } else {
    for (const item of state.historyItems) {
      const article = node('article', { className: 'history-item' });
      const copy = node('div', { className: 'history-item-copy' });
      copy.append(
        node('h2', { className: 'history-item-title', text: item.title }),
        node('p', {
          className: 'history-item-time',
          text: `创建：${formatTime(item.createdAt)} · 更新：${formatTime(item.updatedAt)}`,
        }),
      );
      const actions = node('div', { className: 'history-item-actions' });
      const detail = button('查看详情', 'detail', item.id, 'btn btn-primary');
      const remove = button('删除历史', 'delete', item.id);
      detail.addEventListener('click', () => handlers.openHistoryDetail(item.id));
      remove.addEventListener('click', () => handlers.deleteHistoryRecord(item.id));
      actions.append(detail, remove);
      article.append(copy, actions);
      list.append(article);
    }
  }
  page.append(list);
  if (state.historyCursor) {
    const more = button('加载更多', 'more', null, 'btn btn-ghost history-load-more');
    more.addEventListener('click', handlers.loadMoreHistory);
    page.append(more);
  }
  if (state.historySync.message && state.historySync.status === 'list-error') {
    page.append(node('p', { className: 'history-error', text: state.historySync.message }));
  }
  return page;
}

export function renderHistoryDetail(state, handlers) {
  const detail = state.historyDetail;
  const page = node('section', { className: 'history-page history-detail' });
  if (!detail) {
    page.append(pageHeader('历史详情', '正在读取记录…', handlers, { detail: true }));
    return page;
  }
  page.append(pageHeader(detail.title, '只读快照', handlers, { detail: true }));

  const meta = node('section', { className: 'history-section history-meta' });
  meta.append(
    node('h2', { className: 'history-section-title', text: '员工输入摘要' }),
    node('p', { text: `岗位：${detail.intake.role}` }),
    node('p', { text: `入职时长：${detail.intake.tenure}` }),
    node('p', { text: `绩效状态：${detail.intake.performance}` }),
    node('p', { text: `目标：${detail.intake.goal || '未填写'}` }),
    node('p', { text: `辅导困扰：${detail.intake.pain || '未填写'}` }),
    node('p', { text: `员工特征：${detail.intake.traits || '未填写'}` }),
  );
  page.append(meta);

  const plan = node('section', { className: 'history-plan' });
  plan.append(
    markdownSection('沟通切入点', detail.plan.entry),
    markdownSection('沟通注意事项', detail.plan.cautions),
    markdownSection('建议沟通频率', detail.plan.frequency),
    markdownSection('绩效差距修正方法', detail.plan.gap_fix),
    markdownSection('话术示例', detail.plan.scripts),
  );
  page.append(plan);

  if (detail.feedback) {
    const feedback = node('section', { className: 'history-feedback' });
    feedback.append(
      node('h2', { className: 'history-group-title', text: '辅导反馈' }),
      node('p', { className: 'history-feedback-text', text: detail.feedbackText || '' }),
      markdownSection('进展解读', detail.feedback.progress_read),
      markdownSection('下一步建议', detail.feedback.next_steps),
      markdownSection('观察要点', detail.feedback.watch_points),
    );
    page.append(feedback);
  }

  const actions = node('div', { className: 'history-detail-actions' });
  const copy = button('复制方案', 'copy', detail.id, 'btn btn-primary');
  const remove = button('删除历史', 'delete', detail.id);
  copy.addEventListener('click', handlers.copyHistoryPlan);
  remove.addEventListener('click', () => handlers.deleteHistoryRecord(detail.id));
  actions.append(copy, remove);
  page.append(actions);
  return page;
}
