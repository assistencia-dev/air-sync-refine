import { useState } from "react";
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
  const [imageUnavailable, setImageUnavailable] = useState(false);

  return (
    <span className={`dbs-brand-logo ${frameClassName}`.trim()}>
      {imageUnavailable ? (
        <span
          className={`dbs-brand-logo-fallback ${imageClassName}`.trim()}
          role="img"
          aria-label={alt}
        >
          <strong>DBS</strong>
          <span>AIR</span>
        </span>
      ) : (
        <img
          src={logoAsset.url}
          alt={alt}
          className={`dbs-brand-logo-image ${imageClassName}`.trim()}
          onError={() => setImageUnavailable(true)}
        />
      )}
    </span>
  );
}
