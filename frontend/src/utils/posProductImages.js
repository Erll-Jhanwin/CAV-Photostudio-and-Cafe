const POS_PRODUCT_IMAGE_BY_ID = Object.freeze({
  14: '/assets/pos-drinks/strawberry-matcha.webp',
  15: '/assets/pos-drinks/sparkling-mango.webp',
  17: '/assets/pos-drinks/sparkling-blueberry.webp',
  18: '/assets/pos-drinks/sparkling-green-apple.webp',
});

export const getPosProductImage = (product) => (
  POS_PRODUCT_IMAGE_BY_ID[Number(product?.id)] || product?.image_url || ''
);

export default POS_PRODUCT_IMAGE_BY_ID;
