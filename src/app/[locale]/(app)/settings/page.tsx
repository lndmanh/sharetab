'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ProfileForm({
  email,
  initialName,
  initialVenmoUsername,
}: {
  email: string;
  initialName: string;
  initialVenmoUsername: string;
}) {
  const t = useTranslations('settings');
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState(initialName);
  const [venmoUsername, setVenmoUsername] = useState(initialVenmoUsername);
  const updateProfile = trpc.profile.updateProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.profile.getProfile.invalidate(), utils.profile.getOperator.invalidate()]);
      router.refresh();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        updateProfile.mutate({ name, venmoUsername: venmoUsername.trim() || null });
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="email">{t('profile.email')}</Label>
        <Input id="email" value={email} disabled />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">{t('profile.name')}</Label>
        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="venmo">{t('profile.venmo')}</Label>
        <Input
          id="venmo"
          value={venmoUsername}
          onChange={(event) => setVenmoUsername(event.target.value)}
          placeholder={t('profile.venmoPlaceholder')}
        />
      </div>
      <Button type="submit" disabled={updateProfile.isPending}>
        {updateProfile.isPending ? t('profile.saving') : t('profile.save')}
      </Button>
      {updateProfile.isSuccess && <p className="text-sm text-green-600">{t('profile.saved')}</p>}
      {updateProfile.error && <p className="text-sm text-red-600">{updateProfile.error.message}</p>}
    </form>
  );
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const profile = trpc.profile.getProfile.useQuery();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('profile.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.data ? (
            <ProfileForm
              key={profile.data.email}
              email={profile.data.email}
              initialName={profile.data.name ?? ''}
              initialVenmoUsername={profile.data.venmoUsername ?? ''}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Loading profile…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
