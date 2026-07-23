const { httpProblem } = require('../http/problem.js');

function authRequiredError() {
  return httpProblem('AUTH_REQUIRED', '请先登录后再继续。', 401);
}

function createRequireAuth({ userRepository }) {
  return async (request, _response, next) => {
    try {
      const userId = request.session?.userId;
      if (!userId) return next(authRequiredError());
      const user = await userRepository.findById(userId);
      if (!user) return next(authRequiredError());
      request.auth = { userId: user.id, user };
      next();
    } catch {
      next(authRequiredError());
    }
  };
}

module.exports = { createRequireAuth };
