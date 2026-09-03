import React, { useEffect, useState, useRef } from 'react';
import { useGameState } from '../../context/GameStateContext';
import { isMaskedAssetUrl, fetchMaskedAssetFile } from '../../api/challenges';
import { API_URL } from '../../api/client';
import {
  Copy,
  Check,
  ExternalLink,
  FileText,
  Database,
  Volume2,
  Film,
  Image as ImageIcon,
  Maximize2,
  X,
  FileDown
} from 'lucide-react';

function getYoutubeEmbedUrl(url) {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=0&rel=0`;
  }
  return null;
}

const EXT_PATTERNS = {
  audio: /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|wma)($|\?)/i,
  video: /\.(mp4|webm|mov|mkv|m4v|avi)($|\?)/i,
  image: /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)($|\?)/i,
  pdf: /\.pdf($|\?)/i,
};

export default function ResourceViewer() {
  const { challengeData, currentRound, currentPhase } = useGameState();
  const phaseData = challengeData?.[currentRound]?.phases?.[currentPhase];
  const [copied, setCopied] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeAssetIdx, setActiveAssetIdx] = useState(0);
  const [assetSrc, setAssetSrc] = useState(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  // Tracks the currently-loaded masked asset (stripped of the 15-min ?t=
  // token) so the 10s poll loop doesn't reload/restart it on every tick.
  const assetRef = useRef(null);

  useEffect(() => {
    setActiveAssetIdx(0);
  }, [currentRound, currentPhase]);

  useEffect(() => {
    if (!phaseData) { setAssetSrc(null); setAssetError(false); setAssetLoading(false); return undefined; }

    const assetsList = phaseData.assets || [];
    const safeIdx = Math.min(activeAssetIdx, Math.max(0, assetsList.length - 1));
    const url = (assetsList[safeIdx]?.url || phaseData.resourceUrl || '').trim();
    if (!url || url === '#') { setAssetSrc(null); setAssetError(false); setAssetLoading(false); return undefined; }

    if (!isMaskedAssetUrl(url)) {
      setAssetSrc(url);
      setAssetError(false);
      setAssetLoading(false);
      return undefined;
    }

    // Stable identity of the asset: the signed URL differs by ?t= token on
    // every poll, so compare (and dedupe) on the masked path minus token.
    const base = url.replace(/[?&]t=[^&]*/g, '');
    const now = Date.now();
    const stored = assetRef.current;
    if (stored && stored.base === base) {
      // Already showing this asset. Only force a reload if the media token
      // has been refreshed recently (player needs a fresh one), and for
      // blobs keep the object URL as-is.
      const needsTokenRefresh = stored.isStreamable && now - stored.ts > 14 * 60 * 1000;
      if (!needsTokenRefresh) {
        setAssetLoading(false);
        return undefined;
      }
    }

    // Streamable media (audio/video) is hot-linked straight from the signed
    // masked URL so the player can range-request instead of waiting for a
    // full blob download. The ?t= media token lets <audio>/<video> load it
    // cross-site without cookies. Fall back to the Bearer blob path when the
    // server is not signing tokens yet (MEDIA_SIGNING_SECRET unset).
    const rawType = String(assetsList[safeIdx]?.type || phaseData.resourceType || '').toLowerCase();
    const isStreamable =
      rawType.includes('audio') || rawType.includes('video') ||
      EXT_PATTERNS.audio.test(url) || EXT_PATTERNS.video.test(url) ||
      EXT_PATTERNS.audio.test(assetsList[safeIdx]?.name || '') || EXT_PATTERNS.video.test(assetsList[safeIdx]?.name || '');
    const mediaToken = /[?&]t=/.test(url);

    if (isStreamable && mediaToken) {
      assetRef.current = { base, ts: now, isStreamable: true };
      setAssetSrc(`${API_URL}${url}`);
      setAssetError(false);
      setAssetLoading(false);
      return undefined;
    }

    // Masked non-media paths (image/pdf/files) can't be loaded by <img>/<a>
    // alone: those elements can't send the Authorization header, and the ?t=
    // media token / session cookie alternatives are unreliable (token TTL is
    // 15 min, session TTL 30 min and in-memory). Fetch the blob with the
    // Bearer header and render a local object URL instead.
    setAssetSrc(null);
    setAssetError(false);
    setAssetLoading(true);
    let objectUrl = null;
    fetchMaskedAssetFile(url)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        assetRef.current = { base, ts: now, isStreamable: false };
        setAssetSrc(objectUrl);
        setAssetLoading(false);
      })
      .catch(() => {
        assetRef.current = null;
        setAssetError(true);
        setAssetLoading(false);
      });

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setAssetLoading(false);
    };
  }, [phaseData, phaseData?.assets, phaseData?.resourceUrl, phaseData?.resourceType, activeAssetIdx, currentRound, currentPhase, retryTick]);

  const handleCopy = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!phaseData) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1 items-center justify-center text-center p-4">
        <Database className="h-8 w-8 text-accretion/40 mb-2 animate-pulse" />
        <p className="text-xs sm:text-sm font-orbitron tracking-wider text-foreground/60">AWAITING MISSION DATA...</p>
      </div>
    );
  }

  // assets here are already filtered to this team's allotted set by
  // GameStateContext (filterAssetsBySet).
  const assets = phaseData.assets || [];
  const activeIdx = assets.length > 0 ? Math.min(activeAssetIdx, assets.length - 1) : 0;
  const primaryAsset = assets[activeIdx];
  const rawType = (primaryAsset?.type || phaseData.resourceType || 'text').toLowerCase();
  const url = (primaryAsset?.url || phaseData.resourceUrl || '').trim();
  const fragment = phaseData.story_fragment || {};
  const fragmentTitle = fragment.title || phaseData.title || '';
  const fragmentContent = fragment.content || phaseData.description || '';
  const content = primaryAsset?.content || phaseData.content || fragmentContent || '';
  const assetName = primaryAsset?.name || fragmentTitle;

  // Resolve the displayed URL: masked backend paths are proxied through the
  // authenticated blob fetch above; direct URLs (storage/CDN) load as-is.
  const displayUrl = assetSrc || url;
  const hasValidUrl = Boolean(displayUrl) && displayUrl !== '#';

  // Determine normalized resource type (type field -> MIME -> URL -> asset name)
  let resourceType = 'text';
  if (rawType.includes('audio') || EXT_PATTERNS.audio.test(url) || EXT_PATTERNS.audio.test(assetName)) {
    resourceType = 'audio';
  } else if (rawType.includes('video') || EXT_PATTERNS.video.test(url) || EXT_PATTERNS.video.test(assetName) || getYoutubeEmbedUrl(url)) {
    resourceType = 'video';
  } else if (rawType.includes('image') || rawType.includes('img') || EXT_PATTERNS.image.test(url) || EXT_PATTERNS.image.test(assetName)) {
    resourceType = 'image';
  } else if (rawType.includes('pdf') || EXT_PATTERNS.pdf.test(url) || EXT_PATTERNS.pdf.test(assetName)) {
    resourceType = 'pdf';
  } else if (rawType.includes('text')) {
    if (primaryAsset && hasValidUrl) {
      resourceType = 'file';
    } else {
      resourceType = 'text';
    }
  } else if (!primaryAsset && content) {
    resourceType = 'text';
  } else if (hasValidUrl) {
    resourceType = 'file';
  } else if (content) {
    resourceType = 'text';
  }

  const youtubeEmbed = resourceType === 'video' ? getYoutubeEmbedUrl(displayUrl) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto pr-1 space-y-2.5 scrollbar-hide">
      {/* Phase Header */}
      <div className="shrink-0 border-b border-accretion/20 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="rounded bg-accretion/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-accretion">
            PHASE {phaseData.id || `C${phaseData.order_number || currentPhase}`}
          </span>
          <span className="label-mono text-[8px] text-accretion/70">ACTIVE SECTOR TARGET</span>
        </div>
        <h3 className="font-orbitron text-sm xs:text-base sm:text-lg font-bold tracking-wide text-accretion">
          {phaseData.title}
        </h3>
      </div>

      {/* Intercepted Story Fragment Banner */}
      {fragmentContent && (
        <div className="shrink-0 rounded-lg border border-accretion/40 bg-black/60 p-3 shadow-[0_0_12px_rgba(209,155,131,0.12)]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accretion animate-pulse" />
            <span className="font-orbitron text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-accretion">
              {fragmentTitle ? `TRANSMISSION: ${fragmentTitle.toUpperCase()}` : 'INTERCEPTED STORY FRAGMENT'}
            </span>
          </div>
          <p className="font-mono text-xs sm:text-sm text-starlight/95 leading-relaxed select-all whitespace-pre-wrap">
            {fragmentContent}
          </p>
        </div>
      )}

      {assets.length > 1 && (
        <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {assets.map((asset, idx) => (
            <button
              key={`${asset.id || asset.name || 'asset'}-${idx}`}
              type="button"
              onClick={() => setActiveAssetIdx(idx)}
              className={`shrink-0 rounded border px-2.5 py-1 font-rajdhani text-[10px] tracking-[0.16em] uppercase transition-colors ${
                idx === activeIdx
                  ? 'border-accretion bg-accretion/20 text-accretion'
                  : 'border-copper/25 text-copper/70 hover:border-accretion/50 hover:text-accretion'
              }`}
            >
              {asset.name || `ASSET ${idx + 1}`}
            </button>
          ))}
        </div>
      )}

      {/* Single Playable / Viewable Resource Container */}
      <div className="flex-1 min-h-0 border border-accretion/35 rounded-lg p-2.5 sm:p-3.5 flex flex-col justify-start bg-black/50 relative overflow-y-auto">
        {/* Resource Type Header Tag */}
        <div className="flex items-center justify-between gap-2 border-b border-accretion/20 pb-2 mb-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
            {resourceType === 'audio' && <Volume2 className="h-4 w-4 text-accretion animate-pulse" />}
            {resourceType === 'video' && <Film className="h-4 w-4 text-accretion" />}
            {resourceType === 'image' && <ImageIcon className="h-4 w-4 text-accretion" />}
            {resourceType === 'text' && <FileText className="h-4 w-4 text-accretion" />}
            {resourceType === 'pdf' && <FileDown className="h-4 w-4 text-accretion" />}
            {resourceType === 'file' && <ExternalLink className="h-4 w-4 text-accretion" />}
            <span className="label-mono text-[9px] sm:text-[10px] text-accretion font-bold tracking-wider">
              {resourceType.toUpperCase()} PAYLOAD
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {resourceType === 'text' && content && (
              <button
                type="button"
                onClick={() => handleCopy(content)}
                className="inline-flex items-center gap-1 rounded bg-accretion/15 border border-accretion/30 px-2 py-0.5 font-mono text-[9px] text-accretion transition-all hover:bg-accretion hover:text-black active:scale-95"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span>COPIED</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>COPY</span>
                  </>
                )}
              </button>
            )}

            {hasValidUrl && !assetLoading && (
              <a
                href={displayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded bg-black/60 border border-accretion/30 px-2 py-0.5 font-mono text-[9px] text-copper hover:text-accretion hover:border-accretion transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="h-3 w-3" />
                <span className="hidden xs:inline">RAW</span>
              </a>
            )}
          </div>
        </div>

        {assetLoading && (
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="flex flex-col items-center gap-3">
              <div className="h-6 w-6 border-2 border-accretion border-t-transparent rounded-full animate-spin" />
              <p className="font-orbitron text-[10px] tracking-[0.24em] text-accretion/70">RETRIEVING PAYLOAD...</p>
            </div>
          </div>
        )}
        {assetError && (
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="flex flex-col items-center gap-3">
              <p className="font-orbitron text-[10px] tracking-[0.24em] text-red-300">UPLINK BLOCKED — ASSET COULD NOT BE RETRIEVED</p>
              <button
                type="button"
                onClick={() => { setAssetError(false); setRetryTick(t => t + 1); }}
                className="inline-flex items-center gap-1 rounded bg-accretion/15 border border-accretion/30 px-2.5 py-1 font-mono text-[9px] text-accretion transition-all hover:bg-accretion hover:text-black active:scale-95"
              >
                RETRY
              </button>
            </div>
          </div>
        )}
        {!assetLoading && !assetError && resourceType === 'image' && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 space-y-2">
            {hasValidUrl ? (
              <div className="relative group max-w-full flex items-center justify-center rounded-lg overflow-hidden border border-accretion/40 bg-black/70 shadow-[0_0_20px_rgba(209,155,131,0.15)]">
                <img crossOrigin="use-credentials"
                  src={displayUrl}
                  alt={assetName || "Mission Clue"}
                  className="max-h-[42vh] sm:max-h-[48vh] w-auto max-w-full object-contain rounded cursor-pointer transition-transform duration-300 group-hover:scale-[1.01]"
                  onClick={() => setLightboxOpen(true)}
                  loading="lazy"
                />
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/80 backdrop-blur-sm border border-accretion/50 text-accretion text-[10px] font-orbitron px-2 py-1 rounded shadow opacity-90 transition-opacity hover:opacity-100"
                  aria-label="Enlarge image"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span className="hidden xs:inline">ENLARGE</span>
                </button>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-foreground/60 border border-dashed border-accretion/30 rounded-lg w-full">
                <ImageIcon className="h-8 w-8 text-accretion/40 mx-auto mb-2" />
                <p className="font-orbitron tracking-wider text-accretion/80">IMAGE SIGNAL TRANSMISSION PENDING</p>
                <p className="mt-1 text-copper/60 text-[11px]">No active image URL registered for this phase.</p>
              </div>
            )}
          </div>
        )}

        {/* 2. AUDIO TYPE */}
        {!assetLoading && !assetError && resourceType === 'audio' && (
          <div className="flex flex-col justify-center flex-1 min-h-0 py-2 space-y-3">
            <div className="rounded-lg border border-accretion/45 bg-black/70 p-3.5 sm:p-5 shadow-[0_0_20px_rgba(209,155,131,0.15)]">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-accretion/20 border border-accretion/40 text-accretion">
                    <Volume2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-orbitron text-xs font-bold text-accretion tracking-wider uppercase truncate">
                      {assetName || "Cosmic Audio Signal"}
                    </p>
                    <p className="label-mono text-[8px] text-accretion/70">DECRYPTED FREQUENCY WAVE</p>
                  </div>
                </div>
              </div>

              {/* Decorative Audio Spectrogram Wave Visualizer */}
              <div className="flex items-center justify-center gap-1 h-8 sm:h-10 bg-black/60 rounded border border-accretion/20 px-2 py-1 mb-3">
                {[40, 65, 25, 80, 50, 95, 30, 70, 85, 45, 60, 90, 35, 75, 55, 100, 45, 80, 65, 30, 85, 50, 70, 40].map((h, i) => (
                  <span
                    key={i}
                    className="w-1 bg-accretion/70 rounded-full animate-pulse transition-all duration-300"
                    style={{
                      height: `${h}%`,
                      animationDelay: `${(i % 5) * 150}ms`,
                    }}
                  />
                ))}
              </div>

              {hasValidUrl ? (
                <div className="w-full">
                  <audio crossOrigin="use-credentials"
                    controls
                    preload="metadata"
                    className="w-full h-10 rounded outline-none border border-accretion/40 bg-black"
                  >
                    <source src={displayUrl} type={primaryAsset?.type || 'audio/mpeg'} />
                    Your browser does not support the audio element.
                  </audio>
                </div>
              ) : (
                <div className="text-center py-2 text-xs text-copper/60 font-mono">
                  [Audio link awaiting sector frequency lock]
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. VIDEO TYPE */}
        {!assetLoading && !assetError && resourceType === 'video' && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 space-y-2">
            {hasValidUrl ? (
              <div className="relative w-full overflow-hidden rounded-lg border border-accretion/45 bg-black/80 shadow-[0_0_20px_rgba(209,155,131,0.2)]">
                {youtubeEmbed ? (
                  <div className="relative w-full aspect-video">
                    <iframe
                      src={youtubeEmbed}
                      title={assetName || "Video Feed"}
                      className="absolute inset-0 h-full w-full border-0 rounded"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <video crossOrigin="use-credentials"
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-[45vh] w-full rounded object-contain bg-black"
                  >
                    <source src={displayUrl} type={primaryAsset?.type || 'video/mp4'} />
                    Your browser does not support the video tag.
                  </video>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-foreground/60 border border-dashed border-accretion/30 rounded-lg w-full">
                <Film className="h-8 w-8 text-accretion/40 mx-auto mb-2" />
                <p className="font-orbitron tracking-wider text-accretion/80">VIDEO FEED OFFLINE</p>
                <p className="mt-1 text-copper/60 text-[11px]">No video feed URL registered for this phase.</p>
              </div>
            )}
          </div>
        )}

        {/* 4. TEXT TYPE */}
        {resourceType === 'text' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="relative flex-1 rounded-lg border border-accretion/40 bg-black/70 p-3 sm:p-4 font-mono overflow-y-auto">
              <div className="text-xs sm:text-sm text-accretion-bright whitespace-pre-wrap break-all select-all leading-relaxed font-mono">
                {content || phaseData.description || "NO TEXT PAYLOAD SPECIFIED"}
              </div>
            </div>
          </div>
        )}

        {/* 5. PDF / FILE FALLBACK */}
        {!assetLoading && !assetError && (resourceType === 'pdf' || resourceType === 'file') && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-0 p-4 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accretion/15 border border-accretion/40 text-accretion">
              <FileDown className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-orbitron text-xs sm:text-sm text-accretion font-bold tracking-wider uppercase">
                {assetName || "External Transmission File"}
              </h4>
              <p className="label-mono text-[8px] text-accretion/70 mt-0.5">
                FORMAT: {resourceType.toUpperCase()}
              </p>
            </div>
            {hasValidUrl ? (
              <a
                href={displayUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={resourceType === 'pdf' || resourceType === 'file' ? assetName || undefined : undefined}
                className="inline-flex min-h-[40px] items-center gap-2 rounded border border-accretion bg-accretion/20 px-4 py-2 font-orbitron text-xs tracking-wider uppercase text-accretion transition-all hover:bg-accretion hover:text-black active:scale-95 shadow-[0_0_12px_rgba(209,155,131,0.25)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open Document / Download</span>
              </a>
            ) : (
              <p className="text-xs text-foreground/60 italic">Document link pending broadcast clearance.</p>
            )}
          </div>
        )}

        {/* Sci-fi corner brackets */}
        <div className="pointer-events-none absolute top-1.5 left-1.5 h-2 w-2 border-t border-l border-accretion/60" />
        <div className="pointer-events-none absolute top-1.5 right-1.5 h-2 w-2 border-t border-r border-accretion/60" />
        <div className="pointer-events-none absolute bottom-1.5 left-1.5 h-2 w-2 border-b border-l border-accretion/60" />
        <div className="pointer-events-none absolute bottom-1.5 right-1.5 h-2 w-2 border-b border-r border-accretion/60" />
      </div>

      {/* Image Lightbox Modal */}
      {lightboxOpen && hasValidUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-6 backdrop-blur-md"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-h-[92vh] max-w-[95vw] rounded-xl border border-accretion/60 bg-black p-2 shadow-[0_0_30px_rgba(209,155,131,0.4)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-accretion/30 pb-1.5 mb-2 px-1">
              <span className="font-orbitron text-xs text-accretion font-bold tracking-wider truncate max-w-[70vw]">
                {assetName || "Image Inspection View"}
              </span>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="rounded p-1 text-accretion hover:bg-accretion/20 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center justify-center max-h-[82vh] overflow-auto">
              <img crossOrigin="use-credentials"
                src={displayUrl}
                alt={assetName || "Enlarged Inspection"}
                className="max-h-[80vh] w-auto max-w-full object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
