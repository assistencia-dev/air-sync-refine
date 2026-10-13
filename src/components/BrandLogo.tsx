import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

type BrandLogoProps = {
  imageClassName?: string;
  frameClassName?: string;
  alt?: string;
};

export function BrandLogo({
  imageClassName = "h-10 w-auto max-w-[190px] object-contain",
  frameClassName = "",
  alt = "DBS Air Refrigeração",
}: BrandLogoProps) {
  return (
    <span className={`dbs-brand-logo ${frameClassName}`.trim()}>
      <img
        src={logoAsset.url}
        alt={alt}
        className={`dbs-brand-logo-image ${imageClassName}`.trim()}
      />
    </span>
  );
}
