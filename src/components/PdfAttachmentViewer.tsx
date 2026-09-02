import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  Maximize2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AttachmentRecord } from "../types";
import { portableAttachmentBlob } from "../lib/attachments";
import { blobToDataUrl } from "../lib/utils";
import { useI18n } from "../hooks/useI18n";
import { getPdfViewerCopy } from "../lib/pdfViewerCopy";
import { getPdfDocument } from "../lib/pdfRuntime";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatBytes(bytes: number, locale: string) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 10 ? 1 : 2 }).format(value)} ${unit}`;
}

function useMeasuredWidth<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!active) return;
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return { ref, width };
}

function PdfCanvas({ document, pageNumber, targetWidth, label, onError }: {
  document: PDFDocumentProxy;
  pageNumber: number;
  targetWidth: number;
  label: string;
  onError: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || targetWidth < 80) return;
    let active = true;
    let renderTask: RenderTask | null = null;
    setRendering(true);
    void document.getPage(pageNumber).then((page) => {
      if (!active) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const cssScale = targetWidth / baseViewport.width;
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: cssScale * outputScale });
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("canvas-context-unavailable");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${Math.round(baseViewport.width * cssScale)}px`;
      canvas.style.height = `${Math.round(baseViewport.height * cssScale)}px`;
      renderTask = page.render({ canvas, canvasContext: context, viewport });
      return renderTask.promise;
    }).then(() => {
      if (active) setRendering(false);
    }).catch((error) => {
      if (!active || error?.name === "RenderingCancelledException") return;
      setRendering(false);
      onError();
    });
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, onError, pageNumber, targetWidth]);

  return <div className={`pdf-canvas-wrap ${rendering ? "is-rendering" : ""}`}>
    <canvas ref={canvasRef} role="img" aria-label={label} />
    {rendering && <span><LoaderCircle size={16} />{label}</span>}
  </div>;
}

export function PdfAttachmentViewer({ attachment, onRemove }: { attachment: AttachmentRecord; onRemove: () => void | Promise<void> }) {
  const { intlLocale, language } = useI18n();
  const copy = getPdfViewerCopy(language);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const { ref: previewStageRef, width: previewWidth } = useMeasuredWidth<HTMLButtonElement>();
  const { ref: readerStageRef, width: readerWidth } = useMeasuredWidth<HTMLDivElement>(readerOpen);
  const handleRenderError = useCallback(() => setRenderFailed(true), []);

  useEffect(() => {
    let active = true;
    let loadingTask: ReturnType<typeof getPdfDocument> | null = null;
    setDocument(null);
    setLoadFailed(false);
    setRenderFailed(false);
    void portableAttachmentBlob(attachment).then(async (blob) => {
      if (!blob.size) throw new Error("empty-pdf");
      loadingTask = getPdfDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
      const loaded = await loadingTask.promise;
      if (!active) {
        await loadingTask.destroy();
        return;
      }
      setDocument(loaded);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [attachment]);

  useEffect(() => {
    if (!readerOpen) return;
    window.requestAnimationFrame(() => readerRef.current?.focus());
  }, [readerOpen]);

  function closeReader() {
    setReaderOpen(false);
    window.requestAnimationFrame(() => previewButtonRef.current?.focus());
  }

  async function saveCopy() {
    if (saving) return;
    setSaving(true);
    try {
      const blob = await portableAttachmentBlob(attachment);
      if (window.chengjing?.files) {
        const dataUrl = await blobToDataUrl(blob);
        await window.chengjing.files.save({
          title: copy.saveTitle,
          defaultPath: attachment.name,
          filters: [{ name: copy.document, extensions: ["pdf"] }],
          data: dataUrl.slice(dataUrl.indexOf(",") + 1),
          encoding: "base64",
        });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = globalThis.document.createElement("a");
        anchor.href = url;
        anchor.download = attachment.name;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      window.alert(copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(copy.confirmRemove(attachment.name))) return;
    try {
      await onRemove();
      closeReader();
    } catch {
      window.alert(copy.removeFailed);
    }
  }

  function handleReaderKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); closeReader(); return; }
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); setPageNumber((value) => clamp(value - 1, 1, document?.numPages || 1)); }
    if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); setPageNumber((value) => clamp(value + 1, 1, document?.numPages || 1)); }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom((value) => clamp(value + 0.15, 0.65, 2.4)); }
    if (event.key === "-") { event.preventDefault(); setZoom((value) => clamp(value - 0.15, 0.65, 2.4)); }
  }

  const failed = loadFailed || renderFailed;
  const metadata = [copy.document, document ? copy.pageCount(document.numPages) : "", formatBytes(attachment.size, intlLocale)].filter(Boolean).join(" · ");
  const previewTargetWidth = Math.min(780, Math.max(260, previewWidth - 42));
  const readerTargetWidth = Math.max(300, readerWidth - 72) * zoom;
  const portalTarget = globalThis.document?.querySelector(".card-editor-panel");

  return <>
    <section className={`pdf-document-preview ${failed ? "is-unavailable" : ""}`}>
      <header>
        <div className="pdf-document-symbol"><FileText size={18} /></div>
        <div><b>{attachment.name}</b><span>{metadata}</span></div>
        <div className="pdf-document-actions">
          <button type="button" onClick={() => void saveCopy()} disabled={saving} aria-label={copy.saveCopy} title={copy.saveCopy}><Download size={15} /></button>
          <button type="button" className="is-danger" onClick={() => void remove()} aria-label={copy.remove} title={copy.remove}><Trash2 size={15} /></button>
        </div>
      </header>
      <button ref={(node) => { previewButtonRef.current = node; previewStageRef.current = node; }} type="button" className="pdf-preview-stage" onClick={() => document && !failed && setReaderOpen(true)} disabled={!document || failed} aria-label={copy.openReaderFor(attachment.name)}>
        {!document && !failed && <span className="pdf-preview-state"><LoaderCircle size={18} />{copy.loadingPreview}</span>}
        {failed && <span className="pdf-preview-state is-error"><FileText size={22} /><b>{copy.previewUnavailable}</b><small>{copy.previewUnavailableHint}</small></span>}
        {document && !failed && <PdfCanvas document={document} pageNumber={1} targetWidth={previewTargetWidth} label={copy.rendering} onError={handleRenderError} />}
        {document && !failed && <span className="pdf-open-reader"><Maximize2 size={14} />{copy.openReader}</span>}
      </button>
    </section>

    {readerOpen && document && portalTarget && createPortal(
      <div ref={readerRef} className="pdf-reader-layer" role="dialog" aria-modal="true" aria-label={`${copy.readerTitle}：${attachment.name}`} tabIndex={-1} onKeyDown={handleReaderKeyDown}>
        <header className="pdf-reader-header">
          <button type="button" className="pdf-reader-back" onClick={closeReader}><ArrowLeft size={16} />{copy.closeReader}</button>
          <div><span>{copy.readerTitle}</span><b>{attachment.name}</b></div>
          <button type="button" className="pdf-reader-save" onClick={() => void saveCopy()} disabled={saving}><Download size={15} />{copy.saveCopy}</button>
        </header>
        <div className="pdf-reader-toolbar" role="toolbar" aria-label={copy.readerTitle}>
          <button type="button" onClick={() => setPageNumber((value) => clamp(value - 1, 1, document.numPages))} disabled={pageNumber <= 1} aria-label={copy.previousPage}><ChevronLeft size={17} /></button>
          <label aria-label={copy.pageStatus(pageNumber, document.numPages)}><span className="sr-only">{copy.page}</span><input value={pageNumber} min={1} max={document.numPages} inputMode="numeric" onChange={(event) => setPageNumber(clamp(Number(event.target.value) || 1, 1, document.numPages))} /><b>/ {document.numPages}</b></label>
          <button type="button" onClick={() => setPageNumber((value) => clamp(value + 1, 1, document.numPages))} disabled={pageNumber >= document.numPages} aria-label={copy.nextPage}><ChevronRight size={17} /></button>
          <i />
          <button type="button" onClick={() => setZoom((value) => clamp(value - 0.15, 0.65, 2.4))} disabled={zoom <= 0.65} aria-label={copy.zoomOut}><ZoomOut size={17} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => clamp(value + 0.15, 0.65, 2.4))} disabled={zoom >= 2.4} aria-label={copy.zoomIn}><ZoomIn size={17} /></button>
          <button type="button" className="pdf-fit-width" onClick={() => setZoom(1)}><Maximize2 size={15} />{copy.fitWidth}</button>
        </div>
        <div ref={readerStageRef} className="pdf-reader-stage">
          <PdfCanvas document={document} pageNumber={pageNumber} targetWidth={readerTargetWidth} label={copy.rendering} onError={handleRenderError} />
        </div>
      </div>,
      portalTarget,
    )}
  </>;
}
