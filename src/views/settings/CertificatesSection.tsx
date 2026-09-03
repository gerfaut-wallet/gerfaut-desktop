import { ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Notice";
import type { CertificateReport } from "../../lib/ipc";
import { LOCALE } from "../../lib/format";
import { useForgetCertificate } from "../../state/queries";
import { useUi } from "../../state/store";
import { SectionCard } from "./primitives";

/** A fingerprint laid out to be compared by eye: two rows of sixteen
    bytes, in the same uppercase hex pairs `openssl` prints. */
export function Fingerprint({ value, tone = "text" }: { value: string; tone?: "text" | "alert" }) {
  const bytes = value.split(":");
  const rows = [bytes.slice(0, 16).join(":"), bytes.slice(16).join(":")].filter(Boolean);
  return (
    <p
      className={clsx(
        "selectable rounded-sm bg-sunken px-3 py-2 font-data text-[13px] leading-6 tracking-[0.02em]",
        tone === "alert" ? "text-alert" : "text-text",
      )}
    >
      {rows.map((row) => (
        <span key={row} className="block">
          {row}
        </span>
      ))}
    </p>
  );
}

/** One labelled fact of a certificate. */
function CertFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-ui text-sm text-text">{children}</dd>
    </div>
  );
}

/** The day a certificate stops being valid. */
function expiryLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(LOCALE, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The decision Gerfaut cannot make for the user: whether this
 * certificate is the one their server presents.
 *
 * A certificate nothing vouches for is a question, not an error: it is
 * asked calmly, with the fingerprint as the subject of the dialog. One
 * that changed after being accepted is an alert, and trusting the new
 * one takes a second, deliberate confirmation.
 */
export function CertificateDialog({
  report,
  busy,
  onAccept,
  onCancel,
}: {
  report: CertificateReport;
  busy: boolean;
  onAccept: (fingerprint: string) => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const changed = report.status === "changed";
  const fingerprint =
    report.status === "changed"
      ? report.presented
      : report.status === "unknown"
        ? report.fingerprint
        : "";

  return (
    <Modal
      open
      onClose={onCancel}
      centered
      width={560}
      title={changed ? "This server's certificate changed" : "This server signs its own certificate"}
    >
      <div className="flex flex-col gap-4">
        {changed ? (
          <>
            <Notice tone="alert">
              {report.host} was accepted with another certificate. Either whoever runs it
              replaced it, or something is answering in its place.
            </Notice>
            <div>
              <p className="mb-1 font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
                Accepted before
              </p>
              <Fingerprint value={report.stored} />
            </div>
            <div>
              <p className="mb-1 font-ui text-[11px] font-medium uppercase tracking-[0.04em] text-alert">
                Presented now
              </p>
              <Fingerprint value={report.presented} tone="alert" />
            </div>
            <p className="font-ui text-sm text-muted">
              Ask whoever runs the server before accepting this one.
            </p>
          </>
        ) : (
          report.status === "unknown" && (
            <>
              <p className="font-ui text-sm text-text">
                No public authority vouches for the certificate of {report.host}. Compare the
                fingerprint below with the one your server shows, then accept it once: Gerfaut
                remembers it and refuses anything else afterwards.
              </p>
              <Fingerprint value={report.fingerprint} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {report.subject && (
                  <div className="col-span-2">
                    <CertFact label="Subject">{report.subject}</CertFact>
                  </div>
                )}
                {report.expires !== null && (
                  <CertFact label="Valid until">{expiryLabel(report.expires)}</CertFact>
                )}
                <CertFact label="Why it is asked">{report.reason}</CertFact>
              </dl>
              <p className="font-ui text-xs text-muted">
                On the server:{" "}
                <span className="selectable font-data text-[12px] text-text">
                  openssl x509 -noout -fingerprint -sha256 -in cert.pem
                </span>
              </p>
            </>
          )
        )}

        <div className="mt-1 flex flex-wrap items-center justify-end gap-3">
          {changed ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => (confirming ? onAccept(fingerprint) : setConfirming(true))}
              >
                {confirming ? "Yes, trust the new certificate" : "Trust the new certificate"}
              </Button>
              <Button variant="primary" onClick={onCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => onAccept(fingerprint)}>
                {busy ? "Saving…" : "Accept and save"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The certificates the user accepted, and the way back out of one. */
export function CertificatesSection({ certs }: { certs: Record<string, string> }) {
  const forget = useForgetCertificate();
  const { showToast } = useUi();
  const [pending, setPending] = useState<string | null>(null);
  const hosts = Object.keys(certs).sort();
  if (hosts.length === 0) return null;

  return (
    <SectionCard icon={<ShieldCheck size={18} strokeWidth={1.5} />} title="Trusted certificates">
      <ul className="flex flex-col divide-y divide-border">
        {hosts.map((host) => (
          <li key={host} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate font-data text-[13px] text-text">{host}</p>
              <p className="truncate font-data text-[11px] text-muted" title={certs[host]}>
                {certs[host]}
              </p>
            </div>
            <Button
              variant="ghost"
              className="h-9 shrink-0 px-2"
              aria-label={`Forget the certificate accepted for ${host}`}
              onClick={() => setPending(host)}
            >
              <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              Forget
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-ui text-xs text-muted">
        Each line is a certificate you accepted for that server. Forget one and Gerfaut asks
        again the next time it connects.
      </p>
      {pending && (
        <Modal open onClose={() => setPending(null)} centered width={440} title="Forget this certificate?">
          <p className="font-ui text-sm text-text">
            Gerfaut will ask again the next time it connects to {pending}, and refuse until the
            certificate is accepted.
          </p>
          <div className="mt-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={forget.isPending}
              onClick={() =>
                void forget.mutateAsync(pending).then(() => {
                  setPending(null);
                  showToast("Certificate forgotten");
                })
              }
            >
              Forget it
            </Button>
          </div>
        </Modal>
      )}
    </SectionCard>
  );
}
