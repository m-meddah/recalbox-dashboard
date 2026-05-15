'use client'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ChevronDown, Monitor } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Props = {
  systems: { name: string; count: number }[]
  currentSystem?: string
}

export function SystemSelector({ systems, currentSystem }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const totalGames = systems.reduce((sum, s) => sum + s.count, 0)

  const handleSelect = (system: string | null) => {
    setOpen(false)
    router.push(system ? `/collection/${system}` : '/collection')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="w-56 justify-between"
          />
        }
      >
        <span className="flex items-center gap-2 min-w-0">
          <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {currentSystem ? (
              <span className="capitalize">{currentSystem}</span>
            ) : (
              <span className="text-muted-foreground">Toutes les consoles</span>
            )}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Rechercher une console…" />
          <CommandList>
            <CommandEmpty>Aucune console trouvée.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => handleSelect(null)}
                className={cn(!currentSystem && 'bg-accent font-medium')}
              >
                <span className="flex-1">Toutes les consoles</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {totalGames.toLocaleString('fr-FR')}
                </span>
              </CommandItem>
              {systems.map((s) => (
                <CommandItem
                  key={s.name}
                  value={s.name}
                  onSelect={() => handleSelect(s.name)}
                  className={cn(currentSystem === s.name && 'bg-accent font-medium')}
                >
                  <span className="flex-1 capitalize">{s.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.count.toLocaleString('fr-FR')}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
