#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#include <math.h>

// True Apple-style continuous superellipse squircle path (n = 5.0 exponent)
static NSBezierPath *CreateAppleSquirclePath(NSRect rect) {
    NSBezierPath *path = [NSBezierPath bezierPath];
    CGFloat cx = NSMidX(rect);
    CGFloat cy = NSMidY(rect);
    CGFloat a = rect.size.width / 2.0;
    CGFloat b = rect.size.height / 2.0;
    CGFloat n = 4.6; // Matches macOS Big Sur / Sequoia icon squircle curvature
    NSInteger steps = 360;

    for (NSInteger i = 0; i <= steps; i++) {
        double theta = (double)i * 2.0 * M_PI / (double)steps;
        double cosT = cos(theta);
        double sinT = sin(theta);
        double x = cx + a * copysign(pow(fabs(cosT), 2.0 / n), cosT);
        double y = cy + b * copysign(pow(fabs(sinT), 2.0 / n), sinT);
        if (i == 0) {
            [path moveToPoint:NSMakePoint(x, y)];
        } else {
            [path lineToPoint:NSMakePoint(x, y)];
        }
    }
    [path closePath];
    return path;
}

static void RenderIconAtSize(NSInteger pixelSize, NSString *outputPath) {
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:NULL
                      pixelsWide:pixelSize
                      pixelsHigh:pixelSize
                   bitsPerSample:8
                 samplesPerPixel:4
                        hasAlpha:YES
                        isPlanar:NO
                  colorSpaceName:NSCalibratedRGBColorSpace
                     bytesPerRow:0
                    bitsPerPixel:0];

    NSGraphicsContext *ctx = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:ctx];
    ctx.shouldAntialias = YES;
    ctx.imageInterpolation = NSImageInterpolationHigh;

    CGContextRef cg = ctx.CGContext;
    CGFloat scale = (CGFloat)pixelSize / 1024.0;
    CGContextScaleCTM(cg, scale, scale);

    // 1. Apple HIG macOS Squircle Bounds (824x824 centered in 1024x1024)
    NSRect cardRect = NSMakeRect(100, 100, 824, 824);
    NSBezierPath *cardPath = CreateAppleSquirclePath(cardRect);

    // 2. Soft Ambient Drop Shadow
    [NSGraphicsContext saveGraphicsState];
    if (pixelSize >= 32) {
        NSShadow *shadow = [[NSShadow alloc] init];
        shadow.shadowOffset = NSMakeSize(0, -16);
        shadow.shadowBlurRadius = 34.0;
        shadow.shadowColor = [NSColor colorWithCalibratedWhite:0.0 alpha:0.20];
        [shadow set];
    }
    [[NSColor whiteColor] setFill];
    [cardPath fill];
    [NSGraphicsContext restoreGraphicsState];

    // 3. Tactile Porcelain Paper Surface
    [NSGraphicsContext saveGraphicsState];
    [cardPath addClip];

    NSGradient *bgGrad = [[NSGradient alloc] initWithColors:@[
        [NSColor colorWithCalibratedRed:0.942 green:0.953 blue:0.974 alpha:1.0], // Bottom cool alabaster
        [NSColor colorWithCalibratedRed:0.998 green:0.999 blue:1.000 alpha:1.0]  // Top pure white
    ]];
    [bgGrad drawInRect:cardRect angle:90.0];

    // Soft ambient azure glow around the underscore cursor (start radius 0 -> zero center dot!)
    NSGradient *glowGrad = [[NSGradient alloc] initWithStartingColor:[NSColor colorWithCalibratedRed:0.06 green:0.46 blue:0.96 alpha:0.10]
                                                         endingColor:[NSColor colorWithCalibratedRed:0.06 green:0.46 blue:0.96 alpha:0.0]];
    [glowGrad drawFromCenter:NSMakePoint(720, 355) radius:0.0 toCenter:NSMakePoint(720, 355) radius:320.0 options:0];

    // Subtle Ruled Notebook Guide Lines (only on >= 128px so small icons stay ultra-clean)
    if (pixelSize >= 128) {
        [[NSColor colorWithCalibratedRed:0.15 green:0.22 blue:0.34 alpha:0.042] setStroke];
        CGFloat lineYs[3] = { 328.0, 512.0, 696.0 };
        for (int i = 0; i < 3; i++) {
            NSBezierPath *rule = [NSBezierPath bezierPath];
            rule.lineWidth = 3.0;
            [rule moveToPoint:NSMakePoint(176, lineYs[i])];
            [rule lineToPoint:NSMakePoint(848, lineYs[i])];
            [rule stroke];
        }
    }

    // Crisp Subtle Rim Border
    NSBezierPath *innerBorder = CreateAppleSquirclePath(NSInsetRect(cardRect, 2.0, 2.0));
    innerBorder.lineWidth = 4.0;
    [[NSColor colorWithCalibratedRed:0.10 green:0.14 blue:0.20 alpha:0.075] setStroke];
    [innerBorder stroke];

    // 4. Precision Geometric "M" Glyph (Deep Obsidian Ink)
    // Optical horizontal span: M [242 .. 606], Underscore [650 .. 786] -> Total [242 .. 786], center = 514!
    CGFloat strokeW = 70.0;
    CGFloat mLeft = 242.0;
    CGFloat mRight = 608.0;
    CGFloat mMid = (mLeft + mRight) / 2.0; // 425.0
    CGFloat mBottom = 328.0;
    CGFloat mTop = 696.0;
    CGFloat mValley = 436.0;

    CGMutablePathRef mCGPath = CGPathCreateMutable();
    CGPathMoveToPoint(mCGPath, NULL, mLeft + strokeW * 0.5, mBottom + strokeW * 0.5);
    CGPathAddLineToPoint(mCGPath, NULL, mLeft + strokeW * 0.5, mTop - strokeW * 0.5);
    CGPathAddLineToPoint(mCGPath, NULL, mMid, mValley);
    CGPathAddLineToPoint(mCGPath, NULL, mRight - strokeW * 0.5, mTop - strokeW * 0.5);
    CGPathAddLineToPoint(mCGPath, NULL, mRight - strokeW * 0.5, mBottom + strokeW * 0.5);

    CGPathRef strokedM = CGPathCreateCopyByStrokingPath(
        mCGPath,
        NULL,
        strokeW,
        kCGLineCapRound,
        kCGLineJoinRound,
        4.0
    );

    // Soft Elevation Shadow under "M"
    [NSGraphicsContext saveGraphicsState];
    CGContextSetShadowWithColor(
        cg,
        CGSizeMake(0, -8),
        16.0,
        [NSColor colorWithCalibratedRed:0.08 green:0.11 blue:0.16 alpha:0.15].CGColor
    );
    CGContextAddPath(cg, strokedM);
    [[NSColor colorWithCalibratedRed:0.12 green:0.14 blue:0.18 alpha:1.0] setFill];
    CGContextFillPath(cg);
    [NSGraphicsContext restoreGraphicsState];

    // Rich Obsidian Gradient inside "M"
    [NSGraphicsContext saveGraphicsState];
    CGContextAddPath(cg, strokedM);
    CGContextClip(cg);
    NSGradient *inkGrad = [[NSGradient alloc] initWithColors:@[
        [NSColor colorWithCalibratedRed:0.09 green:0.105 blue:0.135 alpha:1.0],
        [NSColor colorWithCalibratedRed:0.20 green:0.225 blue:0.275 alpha:1.0]
    ]];
    [inkGrad drawInRect:NSMakeRect(mLeft, mBottom, mRight - mLeft, mTop - mBottom) angle:90.0];
    [NSGraphicsContext restoreGraphicsState];

    CGPathRelease(strokedM);
    CGPathRelease(mCGPath);

    // 5. Signature Markdown Editor Underscore Pill "_" (Cobalt Azure Accent)
    NSRect underscoreRect = NSMakeRect(646.0, 328.0, 140.0, 68.0);
    NSBezierPath *underscorePath = [NSBezierPath bezierPathWithRoundedRect:underscoreRect xRadius:34.0 yRadius:34.0];

    // Soft Azure Glow Shadow
    [NSGraphicsContext saveGraphicsState];
    NSShadow *cursorShadow = [[NSShadow alloc] init];
    cursorShadow.shadowOffset = NSMakeSize(0, -10);
    cursorShadow.shadowBlurRadius = 22.0;
    cursorShadow.shadowColor = [NSColor colorWithCalibratedRed:0.04 green:0.42 blue:0.92 alpha:0.38];
    [cursorShadow set];
    [[NSColor colorWithCalibratedRed:0.04 green:0.42 blue:0.88 alpha:1.0] setFill];
    [underscorePath fill];
    [NSGraphicsContext restoreGraphicsState];

    // Luminous Azure Gradient Fill
    [NSGraphicsContext saveGraphicsState];
    [underscorePath addClip];
    NSGradient *cursorGrad = [[NSGradient alloc] initWithColors:@[
        [NSColor colorWithCalibratedRed:0.035 green:0.405 blue:0.860 alpha:1.0], // #0967DC
        [NSColor colorWithCalibratedRed:0.215 green:0.600 blue:1.000 alpha:1.0]  // #3799FF
    ]];
    [cursorGrad drawInRect:underscoreRect angle:0.0];
    [NSGraphicsContext restoreGraphicsState];

    [NSGraphicsContext restoreGraphicsState]; // end card clip
    [NSGraphicsContext restoreGraphicsState]; // end context

    NSData *pngData = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    [pngData writeToFile:outputPath atomically:YES];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSFileManager *fm = [NSFileManager defaultManager];
        [fm createDirectoryAtPath:@"assets" withIntermediateDirectories:YES attributes:nil error:nil];
        NSString *iconsetDir = @"assets/AppIcon.iconset";
        [fm removeItemAtPath:iconsetDir error:nil];
        [fm createDirectoryAtPath:iconsetDir withIntermediateDirectories:YES attributes:nil error:nil];

        RenderIconAtSize(1024, @"assets/icon.png");

        NSArray *specs = @[
            @[@"icon_16x16.png", @16],
            @[@"icon_16x16@2x.png", @32],
            @[@"icon_32x32.png", @32],
            @[@"icon_32x32@2x.png", @64],
            @[@"icon_128x128.png", @128],
            @[@"icon_128x128@2x.png", @256],
            @[@"icon_256x256.png", @256],
            @[@"icon_256x256@2x.png", @512],
            @[@"icon_512x512.png", @512],
            @[@"icon_512x512@2x.png", @1024]
        ];

        for (NSArray *spec in specs) {
            NSString *filename = spec[0];
            NSInteger px = [spec[1] integerValue];
            RenderIconAtSize(px, [iconsetDir stringByAppendingPathComponent:filename]);
        }

        printf("Generated refined M_ iconset successfully.\n");
    }
    return 0;
}
