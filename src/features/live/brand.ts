/** Phone makers whose status-bar "islands" treat Android's Live Updates their own way (design §3.1). */
export type BrandHint = 'oneplus' | 'oppo' | 'xiaomi' | 'vivo' | 'honor' | 'huawei' | 'samsung';

const BRANDS: [RegExp, BrandHint][] = [
  [/oneplus/, 'oneplus'],
  // realme runs ColorOS underneath.
  [/oppo|realme/, 'oppo'],
  [/xiaomi|redmi|poco/, 'xiaomi'],
  [/vivo|iqoo/, 'vivo'],
  [/honor/, 'honor'],
  [/huawei/, 'huawei'],
  [/samsung/, 'samsung'],
];

/** Build.MANUFACTURER / Build.BRAND → the hint to show, or null for stock Android (Pixel and the like). */
export function brandHint(manufacturer: string | undefined, brand: string | undefined): BrandHint | null {
  const names = `${manufacturer ?? ''} ${brand ?? ''}`.toLowerCase();
  return BRANDS.find(([pattern]) => pattern.test(names))?.[1] ?? null;
}
