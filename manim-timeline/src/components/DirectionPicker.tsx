import type { ManimDirection } from '@/types/scene';

const DIRS: ManimDirection[] = ['UL', 'UP', 'UR', 'LEFT', 'DOWN', 'RIGHT', 'DL', 'DOWN', 'DR'];
const GRID: ManimDirection[][] = [
  ['UL', 'UP', 'UR'],
  ['LEFT', 'DOWN', 'RIGHT'],
  ['DL', 'DOWN', 'DR'],
];

interface DirectionPickerProps {
  value: ManimDirection;
  onChange: (dir: ManimDirection) => void;
  label?: string;
}

export default function DirectionPicker({ value, onChange, label }: DirectionPickerProps) {
  void DIRS; // suppress unused
  return (
    <div className="flex items-start gap-2">
      {label && <span className="text-xs text-slate-400 mt-1">{label}</span>}
      <div className="grid grid-cols-3 gap-0.5">
        {GRID.flat().map((dir, i) => (
          <button
            key={`${dir}-${i}`}
            onClick={() => onChange(dir)}
            className={`w-6 h-6 text-[9px] rounded transition-colors ${
              value === dir
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {dir}
          </button>
        ))}
      </div>
    </div>
  );
}
