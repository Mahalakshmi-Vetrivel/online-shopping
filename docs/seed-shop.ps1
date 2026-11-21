# ===================================================================
#  seed-shop.ps1  -  Fills the Online Shopping Firestore with sample data
#  Adds 12 categories and 60 products (5 per category) using the
#  Firestore REST API. Safe to run twice: it skips anything that
#  already exists (matched by name / title).
# ===================================================================

$ErrorActionPreference = 'Stop'

$projectId = 'online-shopping-b3e8d'
$apiKey    = 'AIzaSyCu498WCp0_BU35xVTX1MauBcZkSR-ENhw'
$base      = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents"

# ---------- Catalog: category name -> products ----------
# t = title, d = description, p = price (INR), q = stock quantity
# Some quantities are below 15 (low stock) and some above 100 (high stock)
# so the inventory reports have something to show.
$catalog = [ordered]@{
  'Electronics' = @(
    @{ t='Wireless Earbuds Pro';        d='Bluetooth 5.3 earbuds with noise cancellation and 30 hours battery'; p=1999;  q=85  },
    @{ t='Smart LED TV 43 inch';        d='Full HD smart TV with built-in apps and 2 HDMI ports';               p=24999; q=12  },
    @{ t='Bluetooth Party Speaker';     d='Portable 20W speaker with deep bass and RGB lights';                p=2499;  q=60  },
    @{ t='Power Bank 20000mAh';         d='Fast-charging power bank with dual USB and Type-C output';          p=1299;  q=140 },
    @{ t='Smart Watch Active';          d='Fitness tracking, heart-rate monitor and 7-day battery';            p=3499;  q=45  }
  )
  'Mobiles & Tablets' = @(
    @{ t='Galaxy Nova 5G Phone';        d='6.6 inch display, 8GB RAM, 128GB storage, 50MP camera';             p=18999; q=30  },
    @{ t='Pixel Lite Smartphone';       d='Clean Android experience with great low-light photos';              p=21999; q=8   },
    @{ t='Tab Plus 10 inch Tablet';     d='10 inch tablet for study and entertainment, 64GB';                  p=14999; q=20  },
    @{ t='Fast Charger 33W';            d='Type-C fast charger with cable';                                    p=799;   q=150 },
    @{ t='Shockproof Phone Cover';      d='Transparent shockproof cover with raised camera edges';             p=299;   q=220 }
  )
  'Computers & Accessories' = @(
    @{ t='Ultrabook 14 Laptop';         d='Intel i5, 16GB RAM, 512GB SSD, 14 inch FHD display';                p=54999; q=10  },
    @{ t='Wireless Mouse Silent';       d='Silent-click wireless mouse with 18-month battery';                 p=599;   q=175 },
    @{ t='Mechanical Keyboard RGB';     d='Blue-switch mechanical keyboard with rainbow backlight';            p=2799;  q=40  },
    @{ t='27 inch IPS Monitor';         d='27 inch IPS monitor, 75Hz, thin bezels';                            p=13499; q=14  },
    @{ t='1TB External Hard Drive';     d='USB 3.0 portable hard drive, 1TB';                                  p=4299;  q=55  }
  )
  'Clothing' = @(
    @{ t='Cotton Kurti Floral';         d='Breathable cotton kurti with floral print';                         p=699;   q=120 },
    @{ t='Mens Slim Fit Shirt';         d='Slim fit formal shirt, wrinkle-free fabric';                        p=899;   q=95  },
    @{ t='Denim Jeans Classic';         d='Stretchable classic blue denim jeans';                              p=1299;  q=70  },
    @{ t='Silk Saree Kanchipuram';      d='Traditional silk saree with zari border';                           p=5999;  q=9   },
    @{ t='Hooded Sweatshirt';           d='Soft fleece hoodie for winter';                                     p=999;   q=48  }
  )
  'Footwear' = @(
    @{ t='Running Shoes Air';           d='Lightweight running shoes with cushioned sole';                     p=2499;  q=65  },
    @{ t='Casual Sneakers White';       d='Classic white sneakers for everyday wear';                          p=1799;  q=80  },
    @{ t='Leather Formal Shoes';        d='Genuine leather formal shoes for office';                           p=2999;  q=13  },
    @{ t='Comfort Flip Flops';          d='Soft anti-slip flip flops';                                         p=299;   q=260 },
    @{ t='Womens Block Heels';          d='Comfortable block heels for parties';                               p=1499;  q=35  }
  )
  'Groceries' = @(
    @{ t='Basmati Rice 5kg';            d='Long-grain aged basmati rice';                                      p=649;   q=200 },
    @{ t='Cold Pressed Groundnut Oil 1L'; d='Traditional cold pressed groundnut oil';                          p=289;   q=130 },
    @{ t='Toor Dal 1kg';                d='Unpolished premium toor dal';                                       p=169;   q=180 },
    @{ t='Filter Coffee Powder 500g';   d='South Indian filter coffee blend';                                  p=349;   q=75  },
    @{ t='Organic Honey 500g';          d='Pure organic forest honey';                                         p=399;   q=11  }
  )
  'Home & Kitchen' = @(
    @{ t='Non-Stick Cookware Set';      d='3-piece non-stick cookware set, induction friendly';                p=1899;  q=40  },
    @{ t='Mixer Grinder 750W';          d='750W mixer grinder with 3 stainless steel jars';                     p=3299;  q=25  },
    @{ t='Steel Water Bottle 1L';       d='Insulated steel bottle, keeps cold for 24 hours';                   p=549;   q=150 },
    @{ t='Cotton Bedsheet Double';      d='Double bedsheet with 2 pillow covers';                              p=899;   q=60  },
    @{ t='Electric Kettle 1.5L';        d='Fast-boil stainless steel electric kettle';                         p=999;   q=7   }
  )
  'Beauty & Personal Care' = @(
    @{ t='Aloe Vera Face Wash';         d='Gentle face wash for daily use';                                    p=199;   q=210 },
    @{ t='Herbal Hair Oil 200ml';       d='Herbal hair oil with bhringraj and amla';                           p=249;   q=140 },
    @{ t='Sunscreen SPF 50';            d='Lightweight sunscreen, no white cast';                              p=399;   q=90  },
    @{ t='Matte Lipstick Set';          d='Set of 3 long-lasting matte lipsticks';                             p=599;   q=12  },
    @{ t='Hair Dryer 1200W';            d='Compact hair dryer with 2 heat settings';                           p=1099;  q=30  }
  )
  'Sports & Fitness' = @(
    @{ t='Yoga Mat 6mm';                d='Anti-slip yoga mat with carry strap';                               p=699;   q=85  },
    @{ t='Badminton Racket Pair';       d='Lightweight aluminium rackets with cover';                          p=1199;  q=50  },
    @{ t='Feather Shuttlecock Box';     d='Box of 10 feather shuttlecocks';                                    p=899;   q=105 },
    @{ t='Adjustable Dumbbells 10kg';   d='Pair of adjustable dumbbells for home workouts';                    p=2299;  q=14  },
    @{ t='Cricket Bat Kashmir Willow';  d='Full-size Kashmir willow cricket bat';                              p=1599;  q=22  }
  )
  'Books & Stationery' = @(
    @{ t='Spiral Notebook Pack of 5';   d='Ruled A5 spiral notebooks, 200 pages each';                         p=349;   q=190 },
    @{ t='Gel Pen Set 10 Colours';      d='Smooth gel pens in 10 colours';                                     p=199;   q=230 },
    @{ t='Aptitude Preparation Guide';  d='Quantitative aptitude and reasoning for placements';                p=499;   q=40  },
    @{ t='Python Programming Basics';   d='Beginner-friendly Python book with exercises';                      p=599;   q=10  },
    @{ t='Desk Organizer Wooden';       d='Wooden organiser for pens and stationery';                          p=449;   q=55  }
  )
  'Toys & Baby' = @(
    @{ t='Building Blocks 200 pcs';     d='Colourful building blocks for creative play';                       p=799;   q=60  },
    @{ t='Remote Control Car';          d='Rechargeable RC car with high speed';                               p=1499;  q=25  },
    @{ t='Soft Teddy Bear Large';       d='Huggable 3 feet soft teddy bear';                                   p=999;   q=13  },
    @{ t='Baby Diapers Medium 64';      d='Pack of 64 soft and dry diapers';                                   p=849;   q=120 },
    @{ t='Kids Drawing Kit';            d='Art kit with crayons, sketch pens and colour pencils';              p=549;   q=70  }
  )
  'Watches & Accessories' = @(
    @{ t='Analog Watch Classic';        d='Leather strap analog watch, water resistant';                       p=1499;  q=45  },
    @{ t='Polarized Sunglasses';        d='UV400 polarized sunglasses';                                        p=799;   q=95  },
    @{ t='Leather Wallet Men';          d='Genuine leather bi-fold wallet';                                    p=599;   q=110 },
    @{ t='Womens Handbag Tote';         d='Spacious tote handbag with zip';                                    p=1299;  q=6   },
    @{ t='Travel Backpack 30L';         d='Water-resistant backpack with laptop sleeve';                       p=1199;  q=38  }
  )
}

# ---------- Helpers ----------
function Invoke-Firestore($method, $path, $bodyObject) {
  $uri = "$base/$path"
  if ($uri.Contains('?')) { $uri += "&key=$apiKey" } else { $uri += "?key=$apiKey" }
  if ($null -ne $bodyObject) {
    $json = $bodyObject | ConvertTo-Json -Depth 20
    return Invoke-RestMethod -Uri $uri -Method $method -Body $json -ContentType 'application/json'
  }
  return Invoke-RestMethod -Uri $uri -Method $method
}

function Get-DocId($doc) { return ($doc.name -split '/')[-1] }

function Get-AllDocs($collection) {
  $all = @(); $token = $null
  do {
    $path = "$collection" + '?pageSize=300'
    if ($token) { $path += "&pageToken=$token" }
    $res = Invoke-Firestore 'GET' $path $null
    if ($res.documents) { $all += $res.documents }
    $token = $res.nextPageToken
  } while ($token)
  return $all
}

$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

# ---------- 1. Categories ----------
Write-Host "`nReading existing categories..." -ForegroundColor Cyan
$catIds = @{}
foreach ($d in (Get-AllDocs 'categories')) { $catIds[$d.fields.name.stringValue] = Get-DocId $d }

foreach ($catName in $catalog.Keys) {
  if ($catIds.ContainsKey($catName)) {
    Write-Host "  = $catName (already exists)" -ForegroundColor DarkGray
  } else {
    $body = @{ fields = @{ name = @{ stringValue = $catName } } }
    $doc = Invoke-Firestore 'POST' 'categories' $body
    $catIds[$catName] = Get-DocId $doc
    Write-Host "  + $catName" -ForegroundColor Green
  }
}

# ---------- 2. Products ----------
Write-Host "`nReading existing products..." -ForegroundColor Cyan
$existingTitles = @{}
foreach ($d in (Get-AllDocs 'inventory')) { if ($d.fields.title) { $existingTitles[$d.fields.title.stringValue] = $true } }

$added = 0; $skipped = 0
foreach ($catName in $catalog.Keys) {
  Write-Host "`n[$catName]" -ForegroundColor Yellow
  foreach ($p in $catalog[$catName]) {
    if ($existingTitles.ContainsKey($p.t)) {
      Write-Host "  = $($p.t) (already exists)" -ForegroundColor DarkGray; $skipped++; continue
    }
    $body = @{ fields = @{
      catId        = @{ stringValue  = $catIds[$catName] }
      categoryName = @{ stringValue  = $catName }
      title        = @{ stringValue  = $p.t }
      description  = @{ stringValue  = $p.d }
      price        = @{ doubleValue  = [double]$p.p }
      qty          = @{ integerValue = "$($p.q)" }
      isActive     = @{ booleanValue = $true }
      createdAt    = @{ timestampValue = $now }
      updatedAt    = @{ timestampValue = $now }
    } }
    $null = Invoke-Firestore 'POST' 'inventory' $body
    Write-Host ("  + {0,-32} Rs.{1,6}   qty {2}" -f $p.t, $p.p, $p.q) -ForegroundColor Green
    $added++
  }
}

Write-Host "`nDone! Categories: $($catIds.Count)   Products added: $added   Skipped: $skipped" -ForegroundColor Cyan
