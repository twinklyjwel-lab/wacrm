'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImportDialog } from '@/components/jewellery/import-dialog';
import { LoyaltyMessages } from '@/components/jewellery/loyalty-messages';
import { LoyaltyOverview } from '@/components/jewellery/loyalty-overview';
import { LoyaltySettingsForm } from '@/components/jewellery/loyalty-settings-form';
import { fetchJson, PageHeader } from '@/components/jewellery/shared';
import type { LoyaltySettings } from '@/lib/loyalty/types';

export default function LoyaltyPage() {
  const t = useTranslations('Jewellery.loyalty');
  const canEdit = useCan('send-messages');
  const [tab, setTab] = useState('overview');
  const [importOpen, setImportOpen] = useState(false);
  const [values, setValues] = useState({ bonus: 1.5, base: 1 });

  useEffect(() => {
    fetchJson<{ settings: LoyaltySettings }>('/api/loyalty/settings')
      .then(({ settings }) => setValues({ bonus: settings.bonus_value, base: settings.base_value }))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <GatedButton canAct={canEdit} gateReason="import customers" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            {t('importCustomers')}
          </GatedButton>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="messages">{t('tabs.messages')}</TabsTrigger>
          <TabsTrigger value="settings">{t('tabs.settings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <LoyaltyOverview bonusValue={values.bonus} baseValue={values.base} />
        </TabsContent>
        <TabsContent value="messages" className="pt-4">
          <LoyaltyMessages />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <LoyaltySettingsForm />
        </TabsContent>
      </Tabs>
      <ImportDialog kind="customers" open={importOpen} onOpenChange={setImportOpen} onDone={() => undefined} />
    </div>
  );
}
