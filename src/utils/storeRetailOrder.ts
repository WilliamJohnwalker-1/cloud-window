export interface StoreRetailCreateItemInput {
  product_id: string;
  quantity: number;
  price?: number;
}

export interface StoreRetailRpcItem {
  product_id: string;
  quantity: number;
}

export const buildStoreRetailOrderRpcItems = (items: StoreRetailCreateItemInput[]): StoreRetailRpcItem[] => {
  return items.map((item) => ({
    product_id: item.product_id,
    quantity: Number(item.quantity),
  }));
};
