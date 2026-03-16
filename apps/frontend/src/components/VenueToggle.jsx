const VENUES = [
  { id: "combined", label: "Combined", color: "#F14755" },
  { id: "polymarket", label: "Polymarket", color: "#F14755" },
  { id: "kalshi", label: "Kalshi", color: "#F14755" },
];

/**
 * VenueToggle — three toggle buttons to filter the order book by venue.
 * Active button gets a filled background in the venue's color.
 */
export default function VenueToggle({ activeVenue, onChange }) {
  return (
    <div className="flex gap-1 bg-panel border border-border rounded-lg p-1">
      {VENUES.map(({ id, label, color }) => {
        const isActive = activeVenue === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className="flex-1 px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150"
            style={
              isActive
                ? { backgroundColor: color + "26", color: "#ffffff", boxShadow: `0 0 10px ${color}40` }
                : { backgroundColor: "transparent", color: "#55556a" }
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
