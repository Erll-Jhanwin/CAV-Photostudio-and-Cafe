import { getPosProductImage } from './posProductImages';

describe('POS drink images', () => {
  test.each([
    [17, 'Sparkling Blueberry', '/assets/pos-drinks/sparkling-blueberry.webp'],
    [18, 'Sparkling Green Apple', '/assets/pos-drinks/sparkling-green-apple.webp'],
    [15, 'Sparkling Mango', '/assets/pos-drinks/sparkling-mango.webp'],
    [14, 'Strawberry Matcha', '/assets/pos-drinks/strawberry-matcha.webp'],
  ])('keeps %s paired with %s by product ID', (id, name, expectedImage) => {
    expect(getPosProductImage({ id, name, image_url: 'https://example.com/old-image.jpg' })).toBe(expectedImage);
  });

  test('uses the product image for IDs without a POS override', () => {
    expect(getPosProductImage({ id: 99, image_url: '/custom-product.webp' })).toBe('/custom-product.webp');
    expect(getPosProductImage({ id: 100 })).toBe('');
  });
});
