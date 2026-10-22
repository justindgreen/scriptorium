import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { CharacterView } from '@/lib/characters'
import type { SendFn } from './shared'

const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const

export function CurrencyPanel({ view, send }: { view: CharacterView; send: SendFn }) {
  const currency = view.aggregate.state.currency
  const [amount, setAmount] = useState(1)
  return (
    <Card data-testid="currency">
      <CardHeader>
        <CardTitle>Coins</CardTitle>
        <CardDescription>Spending below zero is refused.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <label className="flex items-center gap-2 print:hidden" htmlFor="coin-amount">
          Amount
          <Input
            id="coin-amount"
            type="number"
            min={1}
            className="w-24"
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
            data-testid="coin-amount"
          />
        </label>
        <ul className="grid gap-1">
          {COINS.map((coin) => (
            <li key={coin} className="flex items-center justify-between gap-2">
              <span>
                <span className="uppercase text-muted-foreground">{coin}</span>{' '}
                <span className="tabular font-medium" data-testid={`coin-${coin}`}>
                  {currency[coin]}
                </span>
              </span>
              <span className="flex gap-1 print:hidden">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void send({ type: 'adjustCurrency', delta: { [coin]: amount } })}
                  data-testid={`coin-add-${coin}`}
                >
                  +
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currency[coin] < amount}
                  onClick={() => void send({ type: 'adjustCurrency', delta: { [coin]: -amount } })}
                  data-testid={`coin-spend-${coin}`}
                >
                  −
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
