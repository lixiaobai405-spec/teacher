const express = require('express');

const { httpProblem } = require('../http/problem.js');

function historyNotFound() {
  return httpProblem('HISTORY_NOT_FOUND', '历史记录不存在。', 404);
}

function databaseUnavailable() {
  return httpProblem(
    'DATABASE_UNAVAILABLE',
    '历史数据库暂时不可用，请稍后重试。',
    503,
  );
}

function isInputError(error) {
  return error?.code === 'INPUT_INVALID' && error.status === 400;
}

function createHistoryRouter({ historyRepository } = {}) {
  if (
    !historyRepository
    || typeof historyRepository.save !== 'function'
    || typeof historyRepository.list !== 'function'
    || typeof historyRepository.getById !== 'function'
    || typeof historyRepository.deleteById !== 'function'
  ) {
    throw Object.assign(new Error('A complete historyRepository is required.'), {
      code: 'CONFIG_INVALID',
    });
  }

  const router = express.Router();

  router.post('/', async (request, response, next) => {
    try {
      const result = await historyRepository.save({
        userId: request.auth.userId,
        snapshot: request.body,
      });
      response.status(result.created ? 201 : 200).json({
        ok: true,
        data: result.item,
      });
    } catch (error) {
      next(isInputError(error) ? error : databaseUnavailable());
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      const page = await historyRepository.list({
        userId: request.auth.userId,
        cursor: request.query.cursor,
        limit: request.query.limit,
      });
      response.json({ ok: true, data: page });
    } catch (error) {
      next(isInputError(error) ? error : databaseUnavailable());
    }
  });

  router.get('/:id', async (request, response, next) => {
    try {
      const item = await historyRepository.getById({
        userId: request.auth.userId,
        id: request.params.id,
      });
      if (!item) return next(historyNotFound());
      return response.json({ ok: true, data: item });
    } catch {
      return next(databaseUnavailable());
    }
  });

  router.delete('/:id', async (request, response, next) => {
    try {
      const deleted = await historyRepository.deleteById({
        userId: request.auth.userId,
        id: request.params.id,
      });
      if (!deleted) return next(historyNotFound());
      return response.status(204).end();
    } catch {
      return next(databaseUnavailable());
    }
  });

  return router;
}

module.exports = { createHistoryRouter };
