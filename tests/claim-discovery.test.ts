import { describe, expect, it } from 'vitest';
import { mapCollectedOrders } from '@/modules/claim/discovery';

describe('mapCollectedOrders（注入采集结果 → DiscoveredOrder[]）', () => {
  it('合法订单完整映射（含 claimingInProgress）', () => {
    const orders = mapCollectedOrders([
      {
        orderId: '3317013157118023859',
        goodsName: '  全棉女士三两棉花保暖裤  ',
        goodsInfo: '颜色: 灰色（薄款）',
        seller: '山东飞鹿制衣有限公司',
        orderTime: '2026-11-14 11:48:52',
        claimingInProgress: true,
      },
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      orderId: '3317013157118023859',
      goodsName: '全棉女士三两棉花保暖裤',
      seller: '山东飞鹿制衣有限公司',
      orderTime: '2026-11-14 11:48:52',
      claimingInProgress: true,
    });
  });
  it('orderId 非法/缺失的行丢弃（宁缺勿造）', () => {
    const orders = mapCollectedOrders([
      { orderId: 'ABC123', goodsName: '非法' },
      { orderId: '', goodsName: '空' },
      { goodsName: '无单号' },
      { orderId: '123' },
      'not-an-object',
      null,
    ]);
    expect(orders).toHaveLength(0);
  });
  it('orderId 去重（同一订单多个 entry 行只保留一条）', () => {
    const orders = mapCollectedOrders([
      { orderId: '3317013157118023859', goodsName: '第一条' },
      { orderId: '3317013157118023859', goodsName: '重复' },
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.goodsName).toBe('第一条');
  });
  it('可选字段缺失不报错；claimingInProgress 非 true 归一化', () => {
    const orders = mapCollectedOrders([{ orderId: '3317013157118023859', claimingInProgress: 'yes' }]);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.goodsName).toBeUndefined();
    expect(orders[0]?.claimingInProgress).toBe(false);
  });
  it('非数组输入 → 空数组', () => {
    expect(mapCollectedOrders(undefined)).toEqual([]);
    expect(mapCollectedOrders(null)).toEqual([]);
    expect(mapCollectedOrders({})).toEqual([]);
  });
});
