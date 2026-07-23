function httpProblem(code, message, status) {
  return Object.assign(new Error(message), {
    code,
    message,
    status,
    expose: true,
  });
}

function notFound(_request, _response, next) {
  next(httpProblem('NOT_FOUND', '接口不存在。', 404));
}

function problemHandler(error, _request, response, _next) {
  let normalizedError = error;
  let status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;

  if (error?.type === 'entity.too.large') {
    status = 413;
    normalizedError = httpProblem('REQUEST_TOO_LARGE', '请求体过大，请精简后重试。', status);
  } else if (error?.type === 'entity.parse.failed') {
    status = 400;
    normalizedError = httpProblem('INVALID_REQUEST', '请求无效，请检查后重试。', status);
  }

  const exposed = normalizedError?.expose === true || status < 500;
  const code = exposed && typeof normalizedError?.code === 'string'
    ? normalizedError.code
    : 'INTERNAL_ERROR';
  const message = exposed && typeof normalizedError?.message === 'string'
    ? normalizedError.message
    : '服务内部错误，请稍后重试。';

  response.status(status).json({ ok: false, code, message });
}

module.exports = { httpProblem, notFound, problemHandler };
