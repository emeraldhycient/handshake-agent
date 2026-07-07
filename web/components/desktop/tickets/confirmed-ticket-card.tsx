import { QrPlaceholder } from "@/components/shared/qr-placeholder"

/**
 * Static "confirmed ticket" showcase card. Demo content until the ticketing
 * vertical is wired to real ticket orders (TODO: bind to a live ticket order).
 */
export function ConfirmedTicketCard() {
  return (
    <div className="flex overflow-hidden rounded-[18px] border border-border bg-card">
      {/* Left banner */}
      <div className="relative flex w-[150px] flex-none items-center justify-center bg-gradient-to-br from-primary to-primary-deep">
        {/* Diagonal stripe overlay — uses color-mix to avoid rgba literals */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, color-mix(in oklch, var(--accent) 16%, transparent) 0 12px, transparent 12px 26px)",
          }}
        />
        <div className="relative">
          <QrPlaceholder size={78} />
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 px-5 py-[18px]">
        <p className="text-xs font-bold tracking-widest text-success uppercase">
          Confirmed
        </p>
        <h2 className="mt-0.5 text-[19px] font-extrabold text-foreground">
          Afrobeats Live 2026
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Sat 12 Jul, 8:00pm · Eko Hotel, Lagos
        </p>
        <div className="mt-[14px] flex gap-6">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground">
              Tier
            </p>
            <p className="text-[14px] font-bold text-foreground">Regular</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground">
              Entry code
            </p>
            <p className="font-mono text-[14px] font-bold text-foreground">
              AFL-26-7741
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground">
              Gate
            </p>
            <p className="text-[14px] font-bold text-foreground">Gate B</p>
          </div>
        </div>
      </div>
    </div>
  )
}
