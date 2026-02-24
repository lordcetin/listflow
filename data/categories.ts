
import { Category } from '../types';

export const CATEGORIES: Category[] = [
  {
    id: 'tig-isi',
    name: 'Tığ İşi',
    subProducts: [
      { id: 't1', name: 'Anahtarlık', ornekGorsel: 'https://picsum.photos/seed/t1/200', uretimGorsel: 'https://picsum.photos/seed/t1u/200', maliyet: 8, satisFiyati: 35 },
      { id: 't2', name: 'Amigurumi', ornekGorsel: 'https://picsum.photos/seed/t2/200', uretimGorsel: 'https://picsum.photos/seed/t2u/200', maliyet: 15, satisFiyati: 55 },
      { id: 't3', name: 'Dönence', ornekGorsel: 'https://picsum.photos/seed/t3/200', uretimGorsel: 'https://picsum.photos/seed/t3u/200', maliyet: 35, satisFiyati: 95 },
      { id: 't4', name: 'Kapı Süsü', ornekGorsel: 'https://picsum.photos/seed/t4/200', uretimGorsel: 'https://picsum.photos/seed/t4u/200', maliyet: 45, satisFiyati: 120 },
    ],
  },
  {
    id: 'punch-needle',
    name: 'Punch Needle',
    subProducts: [
      { id: 'p1', name: '4’lü Bardak Altlığı', ornekGorsel: 'https://picsum.photos/seed/p1/200', uretimGorsel: 'https://picsum.photos/seed/p1u/200', maliyet: 12, satisFiyati: 45 },
      { id: 'p2', name: 'Punch Tablo', ornekGorsel: 'https://picsum.photos/seed/p2/200', uretimGorsel: 'https://picsum.photos/seed/p2u/200', maliyet: 25, satisFiyati: 75 },
      { id: 'p3', name: '4’lü Anahtarlık', ornekGorsel: 'https://picsum.photos/seed/p3/200', uretimGorsel: 'https://picsum.photos/seed/p3u/200', maliyet: 10, satisFiyati: 38 },
    ],
  },
  {
    id: '3d-baski',
    name: '3D Baskı',
    subProducts: [
      { id: '3d1', name: 'Anahtarlık', ornekGorsel: 'https://picsum.photos/seed/3d1/200', uretimGorsel: 'https://picsum.photos/seed/3d1u/200', maliyet: 5, satisFiyati: 28 },
      { id: '3d2', name: 'Figür', ornekGorsel: 'https://picsum.photos/seed/3d2/200', uretimGorsel: 'https://picsum.photos/seed/3d2u/200', maliyet: 18, satisFiyati: 52 },
      { id: '3d3', name: '3D Tablo', ornekGorsel: 'https://picsum.photos/seed/3d3/200', uretimGorsel: 'https://picsum.photos/seed/3d3u/200', maliyet: 28, satisFiyati: 85 },
    ],
  },
  {
    id: 'pod',
    name: 'POD (Print On Demand)',
    subProducts: [
      { 
        id: 'pod1', 
        name: 'Tişört', 
        ornekGorsel: 'https://picsum.photos/seed/pod1/200', 
        uretimGorsel: 'https://picsum.photos/seed/pod1u/200', 
        maliyet: 14, 
        satisFiyati: 35,
        variations: [
          { id: 'xs', name: 'S-XL Beden', maliyet: 14, satisFiyati: 35 },
        ]
      },
      { id: 'pod2', name: 'Canvas Tablo', ornekGorsel: 'https://picsum.photos/seed/pod2/200', uretimGorsel: 'https://picsum.photos/seed/pod2u/200', maliyet: 22, satisFiyati: 65 },
      { id: 'pod3', name: 'Pin / Rozet', ornekGorsel: 'https://picsum.photos/seed/pod3/200', uretimGorsel: 'https://picsum.photos/seed/pod3u/200', maliyet: 4, satisFiyati: 22 },
    ],
  },
  {
    id: 'gumus-taki',
    name: 'Gümüş Takı',
    subProducts: [
      { id: 'gt1', name: 'Kolye', ornekGorsel: 'https://picsum.photos/seed/gt1/200', uretimGorsel: 'https://picsum.photos/seed/gt1u/200', maliyet: 25, satisFiyati: 75 },
      { id: 'gt2', name: 'Yüzük', ornekGorsel: 'https://picsum.photos/seed/gt2/200', uretimGorsel: 'https://picsum.photos/seed/gt2u/200', maliyet: 20, satisFiyati: 65 },
      { id: 'gt3', name: 'Bilezik', ornekGorsel: 'https://picsum.photos/seed/gt3/200', uretimGorsel: 'https://picsum.photos/seed/gt3u/200', maliyet: 30, satisFiyati: 85 },
    ],
  },
  {
    id: 'cam-baski',
    name: 'Cam Baskı',
    subProducts: [
      { 
        id: 'cb1', 
        name: 'Cam Saat', 
        ornekGorsel: 'https://picsum.photos/seed/cb1/200', 
        uretimGorsel: 'https://picsum.photos/seed/cb1u/200', 
        maliyet: 15, 
        satisFiyati: 55,
        variations: [
          { id: 'v1', name: '26 cm Standart', maliyet: 15, satisFiyati: 55 },
        ]
      },
      { 
        id: 'cb2', 
        name: 'Cam Tablo', 
        ornekGorsel: 'https://picsum.photos/seed/cb2/200', 
        uretimGorsel: 'https://picsum.photos/seed/cb2u/200', 
        maliyet: 22, 
        satisFiyati: 68,
        variations: [
          { id: 't1', name: 'Orta Boy', maliyet: 22, satisFiyati: 68 },
        ]
      },
    ],
  },
  {
    id: 'metal-kesim',
    name: 'Metal Kesim',
    subProducts: [
      { id: 'mk1', name: 'Masa Saati', ornekGorsel: 'https://picsum.photos/seed/mk1/200', uretimGorsel: 'https://picsum.photos/seed/mk1u/200', maliyet: 35, satisFiyati: 95 },
      { id: 'mk2', name: 'Metal Tablo', ornekGorsel: 'https://picsum.photos/seed/mk2/200', uretimGorsel: 'https://picsum.photos/seed/mk2u/200', maliyet: 45, satisFiyati: 135 },
    ],
  },
  {
    id: 'ahsap-kesim',
    name: 'Ahşap Kesim',
    subProducts: [
      { id: 'ak1', name: 'Bardak Altlığı', ornekGorsel: 'https://picsum.photos/seed/ak1/200', uretimGorsel: 'https://picsum.photos/seed/ak1u/200', maliyet: 15, satisFiyati: 48 },
      { id: 'ak2', name: 'Ahşap Tablo', ornekGorsel: 'https://picsum.photos/seed/ak2/200', uretimGorsel: 'https://picsum.photos/seed/ak2u/200', maliyet: 28, satisFiyati: 82 },
    ],
  },
  {
    id: 'aliexpress',
    name: 'Aliexpress Otomasyon',
    subProducts: [
      { id: 'al1', name: 'Ürün Listeleme', ornekGorsel: 'https://picsum.photos/seed/al1/200', uretimGorsel: 'https://picsum.photos/seed/al1u/200', maliyet: 0, satisFiyati: 0 },
    ],
  },
  {
    id: 'kendi-urunlerin',
    name: 'Kendi Ürünlerin (Telegram)',
    subProducts: [
      { id: 'ku1', name: 'Telegram Entegrasyonu', ornekGorsel: 'https://picsum.photos/seed/ku1/200', uretimGorsel: 'https://picsum.photos/seed/ku1u/200', maliyet: 0, satisFiyati: 0 },
    ],
  },
];
