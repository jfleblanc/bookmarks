/** Le logo : un signet accroché au haut de la page */
export function Ribbon({ className = 'ribbon' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 48" aria-hidden="true">
      <path d="M0 0H36V46Q36 48 34.48 46.7L19.52 33.94Q18 32.64 16.48 33.94L1.52 46.7Q0 48 0 46Z" />
    </svg>
  );
}
