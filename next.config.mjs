/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Фотографии объявлений лежат в Supabase Storage (бакет car-images) и
    // отдаются с домена проекта. Хост берём из той же переменной окружения,
    // что и клиент, — второй источник истины для адреса приведёт к тому,
    // что при смене проекта картинки молча перестанут открываться.
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? [
          {
            protocol: 'https',
            hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },

  async headers() {
    return [
      {
        // AASA обязан отдаваться как application/json и БЕЗ расширения .json —
        // иначе iOS не засчитает проверку связи домена и приложения.
        // Next по умолчанию отдал бы файл без расширения как text/plain.
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },
};

export default nextConfig;
