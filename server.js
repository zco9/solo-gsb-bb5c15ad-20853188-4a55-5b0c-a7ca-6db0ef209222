'use strict';

const path = require('path');
const express = require('express');
const Imposition = require('./imposition');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 前后端共享的拼版核心模块（UMD），直接暴露给浏览器 <script> 使用
app.get('/imposition.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(path.join(__dirname, 'imposition.js'));
});

function normalizeAssignmentValue(v) {
  if (v === null || v === undefined || v === '') return null;
  return Number(v);
}

function normalizeAssignments(body) {
  if (!Array.isArray(body.assignments)) return null;
  return body.assignments.map(normalizeAssignmentValue);
}

// 健康检查（供容器 HEALTHCHECK 使用）
app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// 按成品页数生成标准拼版方案（含自动补齐与空白版位）
app.get('/api/signature', (req, res) => {
  try {
    const signature = Imposition.buildSignature(req.query.pages);
    return res.json({
      ...signature,
      assignments: Imposition.initialAssignments(signature)
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// 校验当前版位赋值
app.post('/api/validate', (req, res) => {
  const assignments = normalizeAssignments(req.body || {});
  const issues = Imposition.validate(req.body && req.body.pages, assignments);
  return res.json({
    valid: issues.valid,
    issues: issues,
    messages: Imposition.summarize(issues)
  });
});

// 校验通过后导出 CSV；存在任何错误一律拒绝（HTTP 400）
app.post('/api/export', (req, res) => {
  const assignments = normalizeAssignments(req.body || {});
  const pages = req.body && req.body.pages;
  const issues = Imposition.validate(pages, assignments);

  if (!issues.valid) {
    return res.status(400).json({
      error: '校验未通过，禁止导出',
      messages: Imposition.summarize(issues)
    });
  }

  let csv;
  try {
    csv = Imposition.toCSV(pages, assignments);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // UTF-8 BOM，保证 Excel 打开中文不乱码
  const filename = 'booklet_' + issues.productPages + 'pages.csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"" + filename + "\"");
  return res.send('﻿' + csv);
});

// 兜底：未知 API 路由返回 JSON 404，其余返回首页
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('骑马钉拼版检查应用已启动：http://localhost:' + PORT);
});

module.exports = app;
