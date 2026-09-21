'use client';

import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { dayLabel } from '@/lib/format';

export interface ActivityPoint { date: string; activeMin: number; msgs: number }

/**
 * Two series with different units share one plot, so each gets its own axis and the
 * legend names the unit. Colour carries the series, never the value.
 */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="gActive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gMsgs" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#232c42" vertical={false} />
          <XAxis
            dataKey="date" tickFormatter={dayLabel} minTickGap={24}
            tick={{ fill: '#93a1bd', fontSize: 11 }} axisLine={false} tickLine={false}
          />
          <YAxis yAxisId="left" tick={{ fill: '#93a1bd', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#93a1bd', fontSize: 11 }}
                 axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: '#121826', border: '1px solid #232c42',
              borderRadius: 8, fontSize: 12, color: '#e6ecf8',
            }}
            labelFormatter={(d) => dayLabel(d as string)}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#93a1bd' }} />
          <Area yAxisId="left" type="monotone" dataKey="activeMin" name="Minutos ativos"
                stroke="#60a5fa" fill="url(#gActive)" strokeWidth={2} />
          <Area yAxisId="right" type="monotone" dataKey="msgs" name="Mensagens"
                stroke="#34d399" fill="url(#gMsgs)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
