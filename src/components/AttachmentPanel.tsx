import { useRef, useState } from 'react';
import { Download, FileText, Image, Paperclip, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Attachment } from '../lib/types.ts';

const extensions = '.txt,.md,.csv,.json,.xml,.html,.js,.ts,.py,.java,.cs,.go,.rs,.sql,.pdf,.png,.jpg,.jpeg,.webp';
const mimeFor = (file: File): string => file.type || (/\.md$/i.test(file.name) ? 'text/markdown' : /\.csv$/i.test(file.name) ? 'text/csv' : /\.json$/i.test(file.name) ? 'application/json' : /\.xml$/i.test(file.name) ? 'application/xml' : 'text/plain');

export function AttachmentPanel({ botId, groupId, attachments, onUploaded, onDeleted, onError }: { botId?: string; groupId?: string; attachments: Attachment[]; onUploaded: (attachment: Attachment) => void; onDeleted: (attachment: Attachment) => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Attachment>();
  const ownerPath = groupId ? `/api/groups/${groupId}/attachments` : `/api/bots/${botId}/attachments`;
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const isImage = file.type.startsWith('image/');
      const isBinary = isImage || file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const content = isBinary ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }) : await file.text();
      const data = { name: file.name, mime: /\.pdf$/i.test(file.name) ? 'application/pdf' : mimeFor(file), content, encoding: isBinary ? 'base64' : 'text' };
      onUploaded(await (groupId ? api.uploadGroupAttachment(groupId, data) : api.uploadAttachment(botId ?? '', data)));
    } catch (error) { onError(error instanceof Error ? error.message : 'Attachment upload failed.'); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  };
  const remove = async (attachment: Attachment) => {
    try {
      await (groupId ? api.deleteGroupAttachment(groupId, attachment.id) : api.deleteAttachment(botId ?? '', attachment.id));
      if (selected?.id === attachment.id) setSelected(undefined);
      onDeleted(attachment);
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not remove this attachment.'); }
  };
  return <div className="attachment-panel" role="group" aria-label="Attachments" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !uploading) void upload(file); }}>
    <input ref={input} type="file" aria-label="Choose attachment file" hidden accept={extensions} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <button className="icon-button" title={uploading ? 'Uploading…' : 'Attach or drop a document (5 MB max)'} aria-label="Attach a document or image" onClick={() => input.current?.click()} disabled={uploading}><Paperclip size={17} /></button>
    {attachments.length > 0 && <div className="attachment-list">{attachments.map((attachment) => <span className="attachment-chip" key={attachment.id}>
      <button className="attachment-open" onClick={() => setSelected(attachment)} aria-label={`Preview ${attachment.name}`} title={attachment.metadata.imagePendingAnalysis ? 'Registered image; pixels are not interpreted' : 'Preview extracted attachment text'}>
        {attachment.mime.startsWith('image/') && attachment.imageData
          ? <img src={attachment.imageData} alt={attachment.name} className="attachment-thumb" />
          : attachment.mime.startsWith('image/') ? <Image size={12} /> : <FileText size={12} />}<span>{attachment.name}</span>
      </button>
      <button className="attachment-delete" onClick={() => void remove(attachment)} aria-label={`Remove ${attachment.name}`}><X size={11} /></button>
    </span>)}</div>}
    {selected && <div className="modal-backdrop attachment-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(undefined); }}>
      <section className="modal attachment-preview-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title">
        <header className="modal-header"><div><span className="eyebrow">ATTACHMENT</span><h2 id="attachment-preview-title">{selected.name}</h2><p>{selected.mime} · {selected.size.toLocaleString()} bytes</p></div><button className="icon-button" autoFocus onClick={() => setSelected(undefined)} aria-label="Close attachment preview"><X size={18} /></button></header>
        <div className="attachment-preview-body">
          {selected.metadata.imagePendingAnalysis ? <div className="attachment-uninterpreted"><Image size={24} /><strong>Registered image, not interpreted</strong><p>Relay does not analyze image pixels or provide OCR. The image is registered for reference only and cannot be previewed here.</p></div> : selected.text ? <pre tabIndex={0}>{selected.text.slice(0, 50_000)}{selected.text.length > 50_000 ? '\n\n… Preview limited to 50,000 characters.' : ''}</pre> : <div className="attachment-uninterpreted"><FileText size={24} /><strong>No extractable text</strong><p>This PDF has no extractable text. Relay does not perform OCR.</p></div>}
          {typeof selected.metadata.pageCount === 'number' && <p className="attachment-extraction-note">PDF text extracted from {selected.metadata.pageCount} page{selected.metadata.pageCount === 1 ? '' : 's'} with PDF.js. Layout and images are not interpreted.</p>}
        </div>
        <footer className="modal-actions"><span className="attachment-download-note">Downloads extracted text, not the original binary.</span><a className="button secondary small" href={`${ownerPath}/${selected.id}/download`} download><Download size={14} />Download text</a><button className="button primary small" onClick={() => setSelected(undefined)}>Done</button></footer>
      </section>
    </div>}
  </div>;
}
