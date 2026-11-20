'use strict';

const { parsePagination, buildPagination } = require('../../lib/pagination');

describe('pagination', () => {
  it('keeps the legacy "return everything" behaviour when no paging is asked', () => {
    const paging = parsePagination({});
    expect(paging.requested).toBe(false);
    expect(paging.page).toBe(1);
    expect(paging.offset).toBe(0);
    expect(paging.limit).toBe(100);
  });

  it('computes offset from page and pageSize', () => {
    const paging = parsePagination({ page: '3', pageSize: '10' });
    expect(paging).toMatchObject({ page: 3, pageSize: 10, offset: 20, limit: 10, requested: true });
  });

  it('rejects page 0 and oversized pages', () => {
    expect(parsePagination({ page: '0', pageSize: '10' })).toBeNull();
    expect(parsePagination({ page: '1', pageSize: '101' })).toBeNull();
    expect(parsePagination({ page: 'abc' })).toBeNull();
  });

  it('builds stable metadata including the last page', () => {
    expect(buildPagination(41, { page: 2, pageSize: 20 })).toEqual({
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    });
    expect(buildPagination(0, { page: 1, pageSize: 20 })).toMatchObject({
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  });
});
