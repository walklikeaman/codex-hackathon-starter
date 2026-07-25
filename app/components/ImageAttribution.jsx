"use client";

import { creditLine, isDisplayable, normalizeAttribution } from "../lib/attribution.mjs";

// The credit shown under an image. One component for every source, driven by the
// normalised {source, author, license, url} shape, so a new image feature cannot
// accidentally ship without attribution.
//
// It renders nothing when there is nothing to credit; the FAIL-SAFE (not showing the
// image at all) belongs to the caller, via AttributedImage below.
export function ImageAttribution({ attribution, className = "" }) {
  const normalized = normalizeAttribution(attribution);
  if (!normalized) return null;

  const credit = creditLine(normalized);
  return (
    <small className={`image-credit ${className}`.trim()}>
      {normalized.source_url ? (
        <a href={normalized.source_url} rel="noreferrer noopener nofollow" target="_blank">
          {credit}
        </a>
      ) : credit}
      {normalized.license_url && (
        <>
          {" "}
          <a href={normalized.license_url} rel="noreferrer noopener nofollow license" target="_blank">
            licence
          </a>
        </>
      )}
    </small>
  );
}

// An image that CANNOT be shown without a usable credit.
//
// This is the fail-safe from issue #60: rather than rendering someone's photo with a
// missing author or licence, it renders a placeholder saying so. Silently dropping the
// image would hide a data problem; showing it would breach the licence.
export default function AttributedImage({
  src,
  alt = "",
  attribution,
  className = "",
  loading = "lazy",
  onError,
}) {
  const normalized = normalizeAttribution(attribution, { url: src });

  if (!src) return null;
  if (!isDisplayable(normalized)) {
    return (
      <span className="image-unattributed" role="img" aria-label="Image hidden: source unknown">
        Image hidden — source unknown
      </span>
    );
  }

  return (
    <figure className={`attributed-image ${className}`.trim()}>
      <img alt={alt} loading={loading} onError={onError} src={src} />
      <figcaption>
        <ImageAttribution attribution={normalized} />
      </figcaption>
    </figure>
  );
}
