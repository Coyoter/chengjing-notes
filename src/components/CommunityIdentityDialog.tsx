import { useEffect, useMemo, useState } from "react";
import { Fingerprint, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useAppStore } from "../store";
import {
  CommunityApiError,
  communityApi,
  communityIdentityPattern,
  normalizeCommunityDisplayName,
  saveCommunityIdentity,
  validateCommunityDisplayName,
  type CommunityIdentity,
} from "../lib/community";
import { getSharedBrainCopy } from "../lib/sharedBrainCopy";
import { IdentitySeal } from "./IdentitySeal";

interface CommunityIdentityDialogProps {
  open: boolean;
  identity: CommunityIdentity | null;
  onReady: (identity: CommunityIdentity) => void;
  onClose: () => void;
}
export function CommunityIdentityDialog({ open, identity, onReady, onClose }: CommunityIdentityDialogProps) {
  const language = useAppStore((state) => state.language);
  const copy = useMemo(() => getSharedBrainCopy(language), [language]);
  const [name, setName] = useState(identity?.displayName || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(identity?.displayName || "");
    setError("");
  }, [identity?.displayName, open]);

  if (!open) return null;
  const validation = validateCommunityDisplayName(name);
  const validationCopy = validation === "required" ? copy.identityRequired
    : validation === "length" ? copy.identityLength
      : validation === "characters" ? copy.identityCharacters
        : validation === "reserved" ? copy.identityReserved : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (validation || busy) { setError(validationCopy); return; }
    setBusy(true); setError("");
    try {
      const displayName = normalizeCommunityDisplayName(name);
      let next: CommunityIdentity;
      if (identity) {
        const result = await communityApi.rename(identity, displayName);
        next = { ...identity, displayName: result.identity.displayName, seal: result.identity.seal, pattern: result.identity.pattern ?? communityIdentityPattern(identity.id) };
      } else {
        next = (await communityApi.register(displayName)).identity;
      }
      saveCommunityIdentity(next);
      window.dispatchEvent(new CustomEvent("chengjing-community-identity", { detail: next }));
      onReady(next);
    } catch (reason) {
      const apiError = reason instanceof CommunityApiError ? reason : new CommunityApiError("request-failed", 0);
      setError(copy.errors[apiError.code] || copy.error);
    } finally { setBusy(false); }
  }

  return (
    <div className="community-dialog-backdrop" onMouseDown={onClose}>
      <form className="community-identity-dialog" role="dialog" aria-modal="true" aria-labelledby="community-identity-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="community-dialog-symbol"><Fingerprint size={21} /></span>
          <div><small>{copy.identityEyebrow}</small><h2 id="community-identity-title">{identity ? copy.identityRename : copy.identityTitle}</h2><p>{copy.identityDescription}</p></div>
          <button type="button" className="bare-button" onClick={onClose} aria-label={copy.close}><X size={18} /></button>
        </header>
        <label className="community-identity-field">
          <span>{copy.identityLabel}</span>
          <div><IdentitySeal color={identity?.seal || "#718a84"} pattern={identity?.pattern ?? communityIdentityPattern(identity?.id || name || "preview")} size="small" /><input autoFocus value={name} maxLength={40} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder={copy.identityPlaceholder} /></div>
          <small>{copy.identityRule}</small>
        </label>
        {(error || validationCopy && name.length > 0) && <p className="community-dialog-error" role="alert">{error || validationCopy}</p>}
        <footer><span><ShieldCheck size={14} />{copy.identityDescription.split("。")[0]}</span><button type="button" onClick={onClose}>{copy.cancel}</button><button type="submit" className="primary-button" disabled={Boolean(validation) || busy}>{busy && <LoaderCircle size={15} className="spin" />}{identity ? copy.identitySave : copy.identityCreate}</button></footer>
      </form>
    </div>
  );
}
