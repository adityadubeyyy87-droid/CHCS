'use strict';

/**
 * Cursor-free offset pagination shared by every list endpoint.
 *
 * Backwards compatibility: when the caller sends neither `page` nor `pageSize`
 * the endpoint keeps returning the full list under its historical key (the
 * React app depends on it). `pagination` metadata is still attached.
 */

const { paginationSchema } = require('./validation');

function parsePagination(query = {}) {
  const wantsPaging = query.page !== undefined || query.pageSize !== undefined;
  const parsed = paginationSchema.safeParse({
    page: query.page ?? 1,
    pageSize: query.pageSize ?? (wantsPaging ? 20 : 100),
  });

  if (!parsed.success) {
    return null;
  }

  const { page, pageSize } = parsed.data;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize,
    requested: wantsPaging,
  };
}

function buildPagination(total, { page, pageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

module.exports = { parsePagination, buildPagination };
