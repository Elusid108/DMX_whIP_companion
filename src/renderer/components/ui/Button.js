const React = require('react');
const cx = require('./cx');

const VARIANTS = {
    quiet: 'btn-quiet',
    primary: 'btn-primary',
    danger: 'btn-danger',
    ghost: 'btn-ghost'
};

// variant: quiet | primary | danger | ghost. block stretches and centres.
const Button = React.forwardRef(({
    variant = 'quiet',
    active = false,
    block = false,
    className,
    type = 'button',
    children,
    ...rest
}, ref) => React.createElement('button', {
    ref,
    type,
    className: cx(VARIANTS[variant] || VARIANTS.quiet, active && 'is-active', block && 'w-full justify-center', className),
    ...rest
}, children));

// Icon-only button: label is the tooltip and the accessible name. Pass
// pressed for toggles (sets aria-pressed and the active style).
const IconButton = React.forwardRef(({
    label,
    icon: Icon,
    iconClassName,
    variant = 'quiet',
    pressed,
    className,
    children,
    ...rest
}, ref) => React.createElement('button', {
    ref,
    type: 'button',
    title: label,
    'aria-label': label,
    'aria-pressed': pressed === undefined ? undefined : Boolean(pressed),
    className: cx(
        VARIANTS[variant] || VARIANTS.quiet,
        variant === 'quiet' && 'flex-none p-1.5',
        pressed && 'is-active',
        className
    ),
    ...rest
}, Icon ? React.createElement(Icon, iconClassName ? { className: iconClassName } : undefined) : children));

module.exports = { Button, IconButton };
